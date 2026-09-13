import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getNovaTask, type NovaTaskResponse } from '@/lib/ccode-task-client';
import { HTTP_FALLBACK_INTERVAL_MS, NovaTaskSocket } from '@/lib/ccode-task-socket';

vi.mock('@/lib/ccode-task-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ccode-task-client')>();
  return {
    ...actual,
    getNovaTask: vi.fn(),
    getNovaQueueStatus: vi.fn(),
  };
});

const mockedGetNovaTask = vi.mocked(getNovaTask);

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: MockWebSocket[] = [];

  url: string;
  readyState = MockWebSocket.CONNECTING;
  sent: string[] = [];
  private listeners = new Map<string, Set<(event: { data?: string }) => void>>();

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, handler: (event: { data?: string }) => void) {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(handler);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === MockWebSocket.CLOSED) return;
    this.readyState = MockWebSocket.CLOSED;
    this.emit('close');
  }

  open() {
    this.readyState = MockWebSocket.OPEN;
    this.emit('open');
  }

  emit(type: string, event: { data?: string } = {}) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const handler of set) handler(event);
  }
}

function makeTask(overrides: Partial<NovaTaskResponse> = {}): NovaTaskResponse {
  return {
    id: 'task-1',
    status: 'queued',
    ...overrides,
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('NovaTaskSocket HTTP 权威对账', () => {
  let socket: NovaTaskSocket;

  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket);
    vi.useFakeTimers();
    mockedGetNovaTask.mockReset();
    socket = new NovaTaskSocket();
  });

  afterEach(() => {
    socket.disable();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function connectOpen(): MockWebSocket {
    socket.ensureConnected();
    const ws = MockWebSocket.instances.at(-1);
    expect(ws).toBeDefined();
    ws!.open();
    return ws!;
  }

  it('WS OPEN 时订阅仍立刻 GET，并把 processing 交给现有 handler', async () => {
    const ws = connectOpen();
    const handler = vi.fn();
    const processing = makeTask({ status: 'processing' });
    mockedGetNovaTask.mockResolvedValue(processing);

    socket.subscribeTask('task-1', handler);
    await flushMicrotasks();

    expect(mockedGetNovaTask).toHaveBeenCalledTimes(1);
    expect(mockedGetNovaTask).toHaveBeenCalledWith('task-1');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(processing);
    expect(ws.sent.some(payload => {
      const message = JSON.parse(payload) as { type?: string; taskIds?: string[] };
      return message.type === 'subscribeTasks' && message.taskIds?.[0] === 'task-1';
    })).toBe(true);
  });

  it('WS OPEN 期间仍 ≤5s HTTP 对账，补上订阅前已错过的 processing', async () => {
    connectOpen();
    const handler = vi.fn();
    mockedGetNovaTask
      .mockResolvedValueOnce(makeTask({ status: 'queued' }))
      .mockResolvedValueOnce(makeTask({ status: 'processing' }));

    socket.subscribeTask('task-1', handler);
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledWith(makeTask({ status: 'queued' }));

    await vi.advanceTimersByTimeAsync(HTTP_FALLBACK_INTERVAL_MS - 1);
    expect(mockedGetNovaTask).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(mockedGetNovaTask).toHaveBeenCalledTimes(2);
    expect(handler).toHaveBeenLastCalledWith(makeTask({ status: 'processing' }));
    expect(HTTP_FALLBACK_INTERVAL_MS).toBeLessThanOrEqual(5000);
  });

  it('HTTP completed 同样交给现有 handler，便于 finalize 幂等收口', async () => {
    connectOpen();
    const handler = vi.fn();
    const completed = makeTask({
      status: 'completed',
      result: { images: ['URL:https://cdn.example/1.png'] },
    });
    mockedGetNovaTask.mockResolvedValue(completed);

    socket.subscribeTask('task-1', handler);
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledWith(completed);
  });

  it('退订后停止 HTTP 对账', async () => {
    connectOpen();
    mockedGetNovaTask.mockResolvedValue(makeTask({ status: 'processing' }));
    const unsubscribe = socket.subscribeTask('task-1', vi.fn());
    await flushMicrotasks();
    expect(mockedGetNovaTask).toHaveBeenCalledTimes(1);

    unsubscribe();
    await vi.advanceTimersByTimeAsync(HTTP_FALLBACK_INTERVAL_MS * 2);
    expect(mockedGetNovaTask).toHaveBeenCalledTimes(1);
  });
});
