import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ackNovaTask, createNovaTask, getNovaTask, type NovaTaskResponse } from '@/lib/ccode-task-client';
import { downloadAndStoreImages, getStoredBlob } from '@/lib/image-downloader';
import { syncDynamicModelExports } from '@/lib/gemini-config';
import type { StoredJob } from '@/lib/job-store';
import { saveRegistry } from '@/lib/nova-models';
import {
  finalizeCompletedServerTask,
  submitTextToImage,
  retryDownloadCachedImages,
  type SubmitActions,
} from '@/lib/workspace-task-service';
vi.mock('@/lib/ccode-task-client', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ccode-task-client')>();
  return {
    ...actual,
    ackNovaTask: vi.fn(),
    createNovaTask: vi.fn(),
    getNovaTask: vi.fn(),
  };
});

vi.mock('@/lib/image-downloader', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/image-downloader')>();
  return {
    ...actual,
    downloadAndStoreImages: vi.fn(),
    getStoredBlob: vi.fn(),
  };
});

const mockedAckNovaTask = vi.mocked(ackNovaTask);
const mockedGetNovaTask = vi.mocked(getNovaTask);
const mockedCreateNovaTask = vi.mocked(createNovaTask);
const mockedGetStoredBlob = vi.mocked(getStoredBlob);
const mockedDownloadAndStoreImages = vi.mocked(downloadAndStoreImages);

function makeJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'job-1',
    status: 'processing',
    mode: 'text-to-image',
    prompt: 'prompt',
    output_size: '1K',
    temperature: 1,
    aspect_ratio: '1:1',
    model: 'gemini-3-pro-image-preview',
    created_at: '2026-06-07T00:00:00.000Z',
    serverTaskId: 'task-1',
    ...overrides,
  };
}

function makeCompletedTask(images: string[]): NovaTaskResponse {
  return {
    id: 'task-1',
    status: 'completed',
    result: { images },
  };
}

function createActions(initialJob: StoredJob): { actions: SubmitActions; getJob: () => StoredJob } {
  let currentJob = initialJob;
  const actions: SubmitActions = {
    getJob: () => currentJob,
    addJob: vi.fn(),
    replaceJob: vi.fn((_jobId, updater) => {
      currentJob = updater(currentJob);
    }),
    completeJob: vi.fn(async (_jobId, job) => {
      currentJob = job;
    }),
    failJob: vi.fn(async (_jobId, error) => {
      currentJob = { ...currentJob, status: 'failed', error };
    }),
  };

  return {
    actions,
    getJob: () => currentJob,
  };
}

beforeEach(() => {
  localStorage.clear();
  saveRegistry({
    imageModels: [{
      id: 'gpt-image-2',
      protocol: 'openai',
      name: 'GPT Image 2',
      modelId: 'gpt-image-2',
      apiKey: 'test-api-key',
      baseUrl: 'https://api.openai.com',
      builtinPreset: 'gpt-image-2',
      maxRefImages: 16,
      maxOutputSize: '4K',
      supportsAdvancedParams: true,
    }],
    textModels: [],
    defaults: {
      textToImage: 'gpt-image-2',
      imageToImage: 'gpt-image-2',
      reversePrompt: '',
      agent: '',
      promptOptimize: '',
      imageDescribe: '',
      sliceDecomposition: '',
      sliceReconstruct: '',
      sliceImageEdit: '',
    },
  });
  syncDynamicModelExports();
  mockedAckNovaTask.mockReset();
  mockedAckNovaTask.mockResolvedValue(undefined);
  mockedGetNovaTask.mockReset();
  mockedCreateNovaTask.mockReset();
  mockedCreateNovaTask.mockResolvedValue('task-advanced-1');
  mockedDownloadAndStoreImages.mockReset();
  mockedGetStoredBlob.mockReset();
  mockedGetStoredBlob.mockResolvedValue(null);
});

describe('submitTextToImage', () => {
  it('passes GPT Image advanced params into createNovaTask payload', async () => {
    const job = makeJob();
    const { actions, getJob } = createActions(job);

    await submitTextToImage({
      prompts: ['cut out subject'],
      outputSize: '1K',
      aspectRatio: '1:1',
      temperature: 1,
      model: 'gpt-image-2',
      gptImageQuality: 'high',
      gptImageStyle: 'vivid',
      gptImageBackground: 'transparent',
      parallelCount: 1,
    }, actions, vi.fn());

    expect(mockedCreateNovaTask).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'test-api-key',
      mode: 'text-to-image',
      model: 'gpt-image-2',
      gptImageQuality: 'high',
      gptImageStyle: 'vivid',
      gptImageBackground: 'transparent',
    }));
    expect(actions.addJob).toHaveBeenCalledWith(expect.objectContaining({
      gptImageQuality: 'high',
      gptImageStyle: 'vivid',
      gptImageBackground: 'transparent',
    }));
    expect(getJob().serverTaskId).toBe('task-advanced-1');
  });

  it('提交未知 gemini 默认值时 onError 且不 addJob', async () => {
    const job = makeJob();
    const { actions } = createActions(job);
    const onError = vi.fn();

    const ok = await submitTextToImage({
      prompts: ['a cat'],
      outputSize: '1K',
      aspectRatio: '1:1',
      temperature: 1,
      model: 'gemini-3-pro-image-preview',
      gptImageQuality: 'auto',
      gptImageStyle: 'vivid',
      gptImageBackground: 'auto',
      parallelCount: 1,
    }, actions, onError);

    expect(ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('未找到图片模型配置: gemini-3-pro-image-preview');
    expect(actions.addJob).not.toHaveBeenCalled();
    expect(mockedCreateNovaTask).not.toHaveBeenCalled();
  });
});

describe('finalizeCompletedServerTask', () => {
  it('全部 URL 图片缓存成功后替换为 blob URL 并 ack 服务端任务', async () => {
    mockedDownloadAndStoreImages.mockImplementation(async (_jobId, _imageRefs, options) => {
      options?.onProgress?.({ index: 0, status: 'downloading', loadedBytes: 5, totalBytes: 10, percent: 50 });
      options?.onProgress?.({ index: 0, status: 'cached', loadedBytes: 10, totalBytes: 10, percent: 100 });
      return {
        successCount: 1,
        failCount: 0,
        blobUrls: ['blob:cached-0'],
        persisted: [true],
        items: [{ index: 0, status: 'cached', loadedBytes: 10, totalBytes: 10, percent: 100 }],
      };
    });
    const job = makeJob();
    const { actions, getJob } = createActions(job);

    await finalizeCompletedServerTask(job, makeCompletedTask(['URL:/api/nova/images/task-1/0']), actions);

    expect(actions.completeJob).toHaveBeenCalledTimes(3);
    expect(getJob().images).toEqual(['blob:cached-0']);
    expect(getJob().serverTaskAcked).toBe(true);
    expect(getJob().imageDownloadProgress).toBeUndefined();
    expect(mockedAckNovaTask).toHaveBeenCalledWith('task-1');
  });

  it('部分 URL 图片缓存失败时保留 URL 引用和失败进度且不 ack', async () => {
    mockedDownloadAndStoreImages.mockImplementation(async (_jobId, _imageRefs, options) => {
      options?.onProgress?.({ index: 0, status: 'cached', loadedBytes: 10, totalBytes: 10, percent: 100 });
      options?.onProgress?.({ index: 1, status: 'failed', loadedBytes: 2, totalBytes: 10, percent: 20, error: 'stream failed' });
      return {
        successCount: 1,
        failCount: 1,
        blobUrls: ['blob:cached-0', ''],
        persisted: [true, false],
        items: [
          { index: 0, status: 'cached', loadedBytes: 10, totalBytes: 10, percent: 100 },
          { index: 1, status: 'failed', loadedBytes: 2, totalBytes: 10, percent: 20, error: 'stream failed' },
        ],
      };
    });
    const job = makeJob();
    const { actions, getJob } = createActions(job);

    await finalizeCompletedServerTask(job, makeCompletedTask([
      'URL:/api/nova/images/task-1/0',
      'URL:/api/nova/images/task-1/1',
    ]), actions);

    expect(getJob().images).toEqual([
      'blob:cached-0',
      'URL:/api/nova/images/task-1/1',
    ]);
    expect(getJob().serverTaskAcked).toBe(false);
    expect(getJob().warning).toContain('1 张图片未保存到本机');
    expect(getJob().imageDownloadProgress?.failed).toBe(1);
    expect(mockedAckNovaTask).not.toHaveBeenCalled();
  });
});


describe('持久化与确认门禁', () => {
  const successfulDownload = () => ({
    successCount: 1, failCount: 0, blobUrls: ['blob:saved'], persisted: [true],
    items: [{ index: 0, status: 'cached' as const, loadedBytes: 10 }],
  });

  it('元数据提交失败不得ACK，保留来源及真实到期时间', async () => {
    mockedDownloadAndStoreImages.mockResolvedValue(successfulDownload());
    const { actions, getJob } = createActions(makeJob());
    const actualComplete = actions.completeJob;
    actions.completeJob = vi.fn(async (id, job) => {
      await actualComplete(id, job);
      if (job.localPersistence === 'saved') throw new Error('QuotaExceededError');
    });
    await finalizeCompletedServerTask(makeJob(), {
      ...makeCompletedTask(['URL:/server/image']), expiresAt: '2026-10-23T00:00:00Z',
    }, actions);
    expect(mockedAckNovaTask).not.toHaveBeenCalled();
    expect(getJob().localPersistence).toBe('temporary');
    expect(getJob().recoveryImages).toEqual(['URL:/server/image']);
    expect(getJob().serverExpiresAt).toBe('2026-10-23T00:00:00Z');
  });

  it('全部字节与元数据提交之后才ACK，ACK失败最多两次且保留本机成功', async () => {
    mockedDownloadAndStoreImages.mockResolvedValue(successfulDownload());
    mockedAckNovaTask.mockRejectedValue(new Error('HTTP 503'));
    const order: string[] = [];
    const { actions, getJob } = createActions(makeJob());
    const actualComplete = actions.completeJob;
    actions.completeJob = vi.fn(async (id, job) => {
      await actualComplete(id, job);
      if (job.localPersistence === 'saved') order.push('committed');
    });
    mockedAckNovaTask.mockImplementation(async () => { order.push('ack'); throw new Error('HTTP 503'); });
    await finalizeCompletedServerTask(makeJob(), makeCompletedTask(['URL:/server/image']), actions);
    expect(order).toEqual(['committed', 'ack', 'ack']);
    expect(getJob().localPersistence).toBe('saved');
    expect(getJob().serverTaskAcked).toBe(false);
    expect(getJob().warning).toContain('领取确认失败');
  });

  it('重复完成通知共用一次下载，删除后不得保存或ACK', async () => {
    let finish!: (value: ReturnType<typeof successfulDownload>) => void;
    mockedDownloadAndStoreImages.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const { actions } = createActions(makeJob());
    const first = finalizeCompletedServerTask(makeJob(), makeCompletedTask(['URL:/server/image']), actions);
    const second = finalizeCompletedServerTask(makeJob(), makeCompletedTask(['URL:/server/image']), actions);
    await vi.waitFor(() => expect(mockedDownloadAndStoreImages).toHaveBeenCalledTimes(1));
    actions.getJob = () => undefined;
    vi.stubGlobal('URL', { revokeObjectURL: vi.fn() });
    finish(successfulDownload());
    await Promise.all([first, second]);
    expect(mockedDownloadAndStoreImages).toHaveBeenCalledTimes(1);
    expect(actions.completeJob).toHaveBeenCalledTimes(1);
    expect(mockedAckNovaTask).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('仅临时内存预览的多图结果不可提前ACK', async () => {
    mockedDownloadAndStoreImages.mockResolvedValue({
      successCount: 1, failCount: 1, blobUrls: ['blob:saved', 'blob:temporary'], persisted: [true, false],
      items: [{ index: 0, status: 'cached', loadedBytes: 1 }, { index: 1, status: 'failed', loadedBytes: 1 }],
    });
    const { actions, getJob } = createActions(makeJob());
    await finalizeCompletedServerTask(makeJob(), makeCompletedTask(['URL:/a', 'URL:/b']), actions);
    expect(getJob().images).toEqual(['blob:saved', 'blob:temporary']);
    expect(getJob().localPersistedIndexes).toEqual([0]);
    expect(getJob().localPersistence).toBe('temporary');
    expect(mockedAckNovaTask).not.toHaveBeenCalled();
  });

  it('本机完整而服务器过期仍保留本机图片，不查询或重新生成', async () => {
    const job = makeJob({ status: 'completed', localPersistence: 'saved', images: ['IDB:job-1-0'], serverTaskAcked: true });
    const { actions, getJob } = createActions(job);
    await retryDownloadCachedImages(job, actions);
    expect(getJob().images).toEqual(['IDB:job-1-0']);
    expect(mockedGetNovaTask).not.toHaveBeenCalled();
    expect(mockedCreateNovaTask).not.toHaveBeenCalled();
  });

  it('刷新缺图只取回已有任务；服务端过期保留完成卡片', async () => {
    const job = makeJob({ status: 'completed', localPersistence: 'missing' });
    const { actions, getJob } = createActions(job);
    mockedGetNovaTask.mockResolvedValue({ id: 'task-1', status: 'expired' });
    await retryDownloadCachedImages(job, actions);
    expect(mockedGetNovaTask).toHaveBeenCalledWith('task-1');
    expect(mockedCreateNovaTask).not.toHaveBeenCalled();
    expect(getJob().status).toBe('completed');
    expect(getJob().recoveryUnavailable).toBe(true);
    expect(mockedAckNovaTask).not.toHaveBeenCalled();
  });
});


describe('多图部分保存后的精确补取', () => {
  it.each(['IDB:job-1-0', 'blob:already-saved'])('保留已保存槽%s，只下载缺失槽，不受第0远端失效影响', async first => {
    const job = makeJob({
      status: 'completed', localPersistence: 'temporary',
      images: [first, 'URL:/server/1'], localPersistedIndexes: [0],
      recoveryImages: ['URL:/expired/0', 'URL:/server/1'],
    });
    mockedGetStoredBlob.mockImplementation(async (_jobId, index, persistentOnly) => index === 0 && persistentOnly ? new Blob(['old']) : null);
    mockedGetNovaTask.mockResolvedValue(makeCompletedTask(['URL:/expired/0', 'URL:/server/1']));
    mockedDownloadAndStoreImages.mockImplementation(async (_id, refs) => {
      expect(refs).toEqual(['IDB:job-1-0', 'URL:/server/1']);
      return { successCount: 1, failCount: 0, blobUrls: ['', 'blob:new'], persisted: [false, true], items: [] };
    });
    const { actions, getJob } = createActions(job);
    await retryDownloadCachedImages(job, actions);
    expect(getJob().images).toEqual(['IDB:job-1-0', 'blob:new']);
    expect(getJob().localPersistedIndexes).toEqual([0, 1]);
    expect(getJob().serverTaskAcked).toBe(true);
    expect(mockedCreateNovaTask).not.toHaveBeenCalled();
  });
});
