import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  AGENT_CHAT_HARD_TIMEOUT_MS,
  AGENT_CHAT_IDLE_TIMEOUT_MS,
  streamAgentChat,
  type StreamAgentCallbacks,
  type StreamAgentInput,
} from '@/lib/agent-chat-client';
import { readSseStream } from '@/lib/sse-stream-parser';

const encoder = new TextEncoder();

function chatInput(): StreamAgentInput {
  return {
    apiKey: 'sk-test',
    model: 'grok-4.6',
    protocol: 'openai-chat-completions',
    history: [{ id: 'u1', role: 'user', text: '你好', createdAt: 1 }],
    catalog: [],
    modelCatalog: [],
  };
}

function makeCallbacks() {
  return {
    onDelta: vi.fn(),
    onReasoning: vi.fn(),
    onDone: vi.fn(),
    onError: vi.fn(),
    onRetry: vi.fn(),
    onResetAttempt: vi.fn(),
  } satisfies StreamAgentCallbacks;
}

function reasoningFrame(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { reasoning_content: text } }] })}\n\n`;
}

function textFrame(text: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
}

const DONE_FRAME = 'data: [DONE]\n\n';

interface PushableSse {
  push: (chunk: string) => void;
  close: () => void;
}

function mockSseFetch(onReady: (pushable: PushableSse) => void): void {
  vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: RequestInit) => {
    let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
    const pending: Uint8Array[] = [];
    let closed = false;

    const push = (chunk: string) => {
      const bytes = encoder.encode(chunk);
      if (controllerRef) controllerRef.enqueue(bytes);
      else pending.push(bytes);
    };
    const close = () => {
      closed = true;
      try { controllerRef?.close(); } catch { /* ignore */ }
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controllerRef = controller;
        for (const bytes of pending) controller.enqueue(bytes);
        pending.length = 0;
        if (closed) {
          try { controller.close(); } catch { /* ignore */ }
        }
        const onAbort = () => {
          try {
            controller.error(init?.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
          } catch { /* ignore */ }
        };
        if (init?.signal?.aborted) onAbort();
        else init?.signal?.addEventListener('abort', onAbort, { once: true });
      },
    });

    onReady({ push, close });
    return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  }));
}

async function flushMicrotasks(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe('agent chat idle timeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('20s 后收到 reasoning 帧，45s 墙钟不会被杀；idle-timeout 不会自动重试', async () => {
    let pushable: PushableSse | null = null;
    mockSseFetch(next => { pushable = next; });
    const callbacks = makeCallbacks();

    const handle = streamAgentChat(chatInput(), callbacks);
    await flushMicrotasks();
    expect(pushable).not.toBeNull();

    await vi.advanceTimersByTimeAsync(20_000);
    pushable!.push(reasoningFrame('先想一下'));
    await flushMicrotasks();

    // 旧实现会在 45s 墙钟 abort；空闲计时已在 20s 被 reasoning 续上
    await vi.advanceTimersByTimeAsync(25_000);
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onRetry).not.toHaveBeenCalled();
    expect(callbacks.onReasoning).toHaveBeenCalled();

    pushable!.push(textFrame('你好，我是助手。'));
    pushable!.push(DONE_FRAME);
    pushable!.close();
    await handle.promise;

    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(callbacks.onDone).toHaveBeenCalled();
    expect(callbacks.onDelta).toHaveBeenCalled();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('一直不写帧则 idle-timeout abort，且只请求一次（超时不再 3 次重试）', async () => {
    mockSseFetch(() => { /* 永不写帧 */ });
    const callbacks = makeCallbacks();

    const handle = streamAgentChat(chatInput(), callbacks);
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(AGENT_CHAT_IDLE_TIMEOUT_MS - 1);
    expect(callbacks.onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await handle.promise;

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError.mock.calls[0][0].message).toMatch(/超过 45 秒未响应/);
    expect(callbacks.onRetry).not.toHaveBeenCalled();
    expect(callbacks.onResetAttempt).not.toHaveBeenCalled();
    expect(callbacks.onDone).not.toHaveBeenCalled();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it('keepalive comment 帧会续上空闲计时，不会在 45s 墙钟被杀', async () => {
    let pushable: PushableSse | null = null;
    mockSseFetch(next => { pushable = next; });
    const callbacks = makeCallbacks();

    const handle = streamAgentChat(chatInput(), callbacks);
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(40_000);
    pushable!.push(': ping\n\n');
    await flushMicrotasks();

    await vi.advanceTimersByTimeAsync(20_000);
    expect(callbacks.onError).not.toHaveBeenCalled();

    pushable!.push(textFrame('还在'));
    pushable!.push(DONE_FRAME);
    pushable!.close();
    await handle.promise;

    expect(callbacks.onDone).toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
  });

  it('持续有 reasoning 帧时，墙钟硬顶仍会 abort', async () => {
    let pushable: PushableSse | null = null;
    mockSseFetch(next => { pushable = next; });
    const callbacks = makeCallbacks();

    const handle = streamAgentChat(chatInput(), callbacks);
    await flushMicrotasks();

    // 每 10s 一帧，空闲计时会被续上；推进到硬顶前一刻仍应活着
    const stepMs = 10_000;
    const steps = Math.floor(AGENT_CHAT_HARD_TIMEOUT_MS / stepMs) - 1;
    for (let i = 0; i < steps; i++) {
      await vi.advanceTimersByTimeAsync(stepMs);
      pushable!.push(reasoningFrame(`step-${i}`));
      await flushMicrotasks();
    }
    expect(callbacks.onError).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(stepMs);
    await handle.promise;

    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onError.mock.calls[0][0].message).toMatch(/超过 180 秒仍未完成/);
    expect(callbacks.onRetry).not.toHaveBeenCalled();
  });

  it('429 仍会自动重试，并回调 onRetry(2/3)', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        return new Response('rate limit', { status: 429, statusText: 'Too Many Requests' });
      }
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(textFrame('重试成功')));
          controller.enqueue(encoder.encode(DONE_FRAME));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }));

    const callbacks = makeCallbacks();
    const handle = streamAgentChat(chatInput(), callbacks);
    await handle.promise;

    expect(callbacks.onRetry).toHaveBeenCalledWith(2, 3, expect.any(Error));
    expect(callbacks.onResetAttempt).toHaveBeenCalledTimes(1);
    expect(callbacks.onDone).toHaveBeenCalled();
    expect(callbacks.onError).not.toHaveBeenCalled();
    expect(calls).toBe(2);
  });
});

describe('readSseStream onActivity', () => {
  it('comment keepalive 没有 data 也会触发 onActivity', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(': ping\n\n'));
        controller.enqueue(encoder.encode('data: {"ok":true}\n\n'));
        controller.close();
      },
    });
    const events: Array<{ data: string }> = [];
    const onActivity = vi.fn();
    await readSseStream(stream, new AbortController().signal, event => events.push(event), onActivity);
    expect(onActivity.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(events.map(event => event.data)).toEqual(['{"ok":true}']);
  });
});
