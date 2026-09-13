import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { ingestParentStudioMessage } from '@/lib/embed/apply-parent';
import { enableEmbeddedModeForTests, resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import { createNovaTask } from '@/lib/ccode-task-client';
import {
  GIF_GRID_ASPECT_RATIO,
  GIF_GRID_OUTPUT_SIZE,
  getGifCompatibleModels,
  loadGifTemplate,
} from '@/lib/gif-job-store';
import { DEFAULT_DEFAULTS, saveRegistry } from '@/lib/nova-models';
import { syncDynamicModelExports } from '@/lib/gemini-config';
import type { ParentNovaStudioConfig } from '@/lib/embed/protocol-map';
import { useGifWorkflow, type SubmitInput } from '@/hooks/useGifWorkflow';

vi.mock('@/lib/ccode-task-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ccode-task-client')>();
  return {
    ...actual,
    createNovaTask: vi.fn(),
    getNovaTask: vi.fn(),
    ackNovaTask: vi.fn(),
  };
});

vi.mock('@/lib/ccode-task-socket', () => ({
  novaTaskSocket: {
    subscribeTask: vi.fn(() => vi.fn()),
  },
}));

vi.mock('@/lib/image-downloader', () => ({
  downloadAndStoreImages: vi.fn(),
  resolveStoredImageRef: vi.fn(),
  revokeBlobUrls: vi.fn(),
  makeStoredBlobRef: vi.fn(),
  deleteStoredBlobs: vi.fn(async () => {}),
}));

vi.mock('@/lib/gif-job-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/gif-job-store')>();
  return {
    ...actual,
    loadGifTemplate: vi.fn(),
  };
});

const mockedCreateNovaTask = vi.mocked(createNovaTask);
const mockedLoadGifTemplate = vi.mocked(loadGifTemplate);

const PARENT_BASE = 'https://parent.example/';

function parentConfig(overrides: Partial<ParentNovaStudioConfig> = {}): ParentNovaStudioConfig {
  return {
    type: 'sub2api:nova-studio-config',
    sessionId: 'sess-gif-workflow',
    revision: 1,
    baseUrl: PARENT_BASE,
    uiMode: 'embedded',
    hideVideo: true,
    hideByokSettings: true,
    ...overrides,
  };
}

function submitInput(model: string): SubmitInput {
  return {
    prompt: '一只虎斑猫缓慢眨眼',
    loop: true,
    closedLoop: false,
    model,
    gptImageQuality: 'auto',
    gptImageStyle: 'auto',
    gptImageBackground: 'auto',
    refImages: [],
    frameDelayMs: 120,
    loopCount: 0,
    framePadding: 1.5,
  };
}

describe('useGifWorkflow.submitGrid 尺寸自适应', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEmbedRuntimeForTests();
    saveRegistry({ imageModels: [], textModels: [], defaults: { ...DEFAULT_DEFAULTS } });
    syncDynamicModelExports();
    mockedCreateNovaTask.mockReset();
    mockedCreateNovaTask.mockResolvedValue('task-gif-1');
    mockedLoadGifTemplate.mockReset();
    mockedLoadGifTemplate.mockResolvedValue({ data: 'dGVtcA==', mimeType: 'image/png' });
  });

  afterEach(() => {
    resetEmbedRuntimeForTests();
    localStorage.clear();
  });

  it('gpt-image-2 提交 customSize 为 1536x1024，prompt 不点名 3264/816', async () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-image',
        model: 'gpt-image-2',
        protocol: 'openai_images',
      },
    }));
    const model = getGifCompatibleModels()[0]?.value;
    const { result } = renderHook(() => useGifWorkflow());
    await act(async () => {
      await result.current.submitGrid(submitInput(model));
    });

    expect(mockedCreateNovaTask).toHaveBeenCalledWith(expect.objectContaining({
      outputSize: GIF_GRID_OUTPUT_SIZE,
      customSize: '1536x1024',
      aspectRatio: GIF_GRID_ASPECT_RATIO,
    }));
    const payload = mockedCreateNovaTask.mock.calls[0]?.[0] as { prompt?: string; customSize?: string };
    expect(payload.customSize).not.toBe('3264x2448');
    expect(payload.prompt).not.toContain('3264');
    expect(payload.prompt).not.toContain('816x816');
    expect(payload.prompt).toContain('4 columns');
    expect(payload.prompt).toContain('3 rows');
  });

  it('grok 提交不传 customSize，outputSize 用模型最大档', async () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-grok',
        model: 'grok-imagine-image-quality',
        protocol: 'grok_images',
      },
    }));
    const model = getGifCompatibleModels()[0]?.value;
    const { result } = renderHook(() => useGifWorkflow());
    await act(async () => {
      await result.current.submitGrid(submitInput(model));
    });

    const payload = mockedCreateNovaTask.mock.calls[0]?.[0] as {
      customSize?: string;
      outputSize?: string;
      prompt?: string;
    };
    expect(payload.customSize).toBeUndefined();
    expect(payload.outputSize).toBe('2K');
    expect(Object.prototype.hasOwnProperty.call(payload, 'customSize')).toBe(false);
    expect(payload.prompt).not.toContain('3264');
    expect(payload.prompt).not.toContain('816x816');
    expect(payload.prompt).toContain('4 columns');
    expect(payload.prompt).toContain('3 rows');
  });

  it('gemini 提交 prompt 不点名 3264/816，仍含 4×3 且对齐 4K', async () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-gemini',
        model: 'gemini-3-pro-image-preview',
        protocol: 'gemini_generate_content',
      },
    }));
    const model = getGifCompatibleModels()[0]?.value;
    const { result } = renderHook(() => useGifWorkflow());
    await act(async () => {
      await result.current.submitGrid(submitInput(model));
    });

    const payload = mockedCreateNovaTask.mock.calls[0]?.[0] as {
      customSize?: string;
      outputSize?: string;
      prompt?: string;
    };
    expect(payload.customSize).toBeUndefined();
    expect(payload.outputSize).toBe('4K');
    expect(payload.prompt).not.toContain('3264');
    expect(payload.prompt).not.toContain('816x816');
    expect(payload.prompt).toContain('4 columns');
    expect(payload.prompt).toContain('3 rows');
    expect(payload.prompt).toContain('4K');
  });
});
