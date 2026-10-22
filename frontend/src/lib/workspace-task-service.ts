import {
  createNovaTask,
  ackNovaTask,
  getNovaTask,
  resolveImageTaskProvider,
  type NovaTaskResponse,
  type ImageReference,
} from '@/lib/ccode-task-client';
import type { ModelId } from '@/lib/gemini-config';
import type { AspectRatio, OutputSize, StoredJob } from '@/lib/job-store';
import {
  getGptImageAdvancedParamsForModel,
  type GptImageBackground,
  type GptImageQuality,
  type GptImageStyle,
  type ParallelCount,
} from '@/lib/model-capabilities';
import { generateUUID } from '@/lib/uuid';
import { downloadAndStoreImages, getStoredBlob, makeStoredBlobRef, parseStoredBlobRef, revokeBlobUrls, type ImageDownloadProgressItem } from '@/lib/image-downloader';

export interface TextToImageSubmitInput {
  prompts: string[];
  outputSize: OutputSize;
  customSize?: string;
  aspectRatio: AspectRatio;
  temperature: number;
  model: string;
  gptImageQuality: GptImageQuality;
  gptImageStyle: GptImageStyle;
  gptImageBackground: GptImageBackground;
  parallelCount: ParallelCount;
}

export interface ImageToImageSubmitInput {
  prompt: string;
  files: { id: string; name: string; dataUrl: string; mimeType: string }[];
  outputSize: OutputSize;
  customSize?: string;
  aspectRatio: AspectRatio;
  temperature: number;
  model: string;
  gptImageQuality: GptImageQuality;
  gptImageStyle: GptImageStyle;
  gptImageBackground: GptImageBackground;
  parallelCount: ParallelCount;
}

export interface SubmitActions {
  addJob: (job: StoredJob) => void;
  replaceJob: (jobId: string, updater: (job: StoredJob) => StoredJob) => void;
  completeJob: (jobId: string, job: StoredJob) => Promise<void>;
  failJob: (jobId: string, error: string, options?: { terminal?: boolean }) => Promise<void>;
  /** 可选：返回最新 job 快照，供异步流程避免使用过期闭包。 */
  getJob?: (jobId: string) => StoredJob | undefined;
}

function buildImageDownloadProgress(items: ImageDownloadProgressItem[]): StoredJob['imageDownloadProgress'] {
  if (items.length === 0) return undefined;
  return {
    total: items.length,
    completed: items.filter(item => item.status === 'cached').length,
    failed: items.filter(item => item.status === 'failed').length,
    items,
  };
}

function createInitialImageDownloadProgress(images: string[]): StoredJob['imageDownloadProgress'] {
  return buildImageDownloadProgress(images.map((image, index) => ({
    index,
    status: image.startsWith('URL:') ? 'pending' : 'cached',
    loadedBytes: 0,
  })));
}

function applyImageDownloadProgress(
  actions: SubmitActions,
  jobId: string,
  images: string[],
  item: ImageDownloadProgressItem,
): void {
  actions.replaceJob(jobId, current => {
    const currentItems = current.imageDownloadProgress?.items?.length === images.length
      ? current.imageDownloadProgress.items
      : createInitialImageDownloadProgress(images)?.items || [];
    const items = currentItems.map(existing => (
      existing.index === item.index ? { ...existing, ...item } : existing
    ));
    return {
      ...current,
      imageDownloadProgress: buildImageDownloadProgress(items),
    };
  });
}

function buildImageReferences(files: ImageToImageSubmitInput['files']): ImageReference[] {
  return files.map(file => ({
    data: file.dataUrl.split(',')[1] || file.dataUrl,
    mimeType: file.mimeType,
  }));
}

function createBaseJob(
  mode: StoredJob['mode'],
  prompt: string,
  outputSize: OutputSize,
  customSize: string | undefined,
  aspectRatio: AspectRatio,
  temperature: number,
  model: string,
  gptImageQuality: GptImageQuality,
  gptImageStyle: GptImageStyle,
  gptImageBackground: GptImageBackground,
  parallelCount: ParallelCount,
  refImages?: StoredJob['refImages']
): StoredJob {
  const advancedParams = getGptImageAdvancedParamsForModel(model as ModelId, {
    quality: gptImageQuality,
    style: gptImageStyle,
    background: gptImageBackground,
  });

  return {
    id: generateUUID(),
    status: 'processing',
    mode,
    prompt,
    originalPrompt: prompt,
    output_size: outputSize,
    custom_size: customSize,
    temperature,
    aspect_ratio: aspectRatio,
    model,
    gptImageQuality: advancedParams.quality,
    gptImageStyle: advancedParams.style,
    gptImageBackground: advancedParams.background,
    parallelCount,
    created_at: new Date().toISOString(),
    refImages,
  };
}

export function buildCompletedJobFromTask(job: StoredJob, task: NovaTaskResponse): StoredJob {
  const images = task.result?.images || [];
  if (task.status === 'completed' && images.length > 0) {
    return {
      ...job,
      status: 'completed',
      images,
      imageData: images[0],
      warning: task.warning,
      serverTaskAcked: false,
      serverExpiresAt: task.expiresAt,
    };
  }

  return {
    ...job,
    status: 'failed',
    error: task.error || (task.status === 'expired' ? '该任务已超出取回时间' : '后端任务失败'),
  };
}

const finalizingJobs = new Map<string, Promise<void>>();

function stillExists(job: StoredJob, actions: SubmitActions): boolean {
  return !actions.getJob || !!actions.getJob(job.id);
}

async function acknowledgeSavedJob(job: StoredJob, actions: SubmitActions): Promise<void> {
  if (!job.serverTaskId || job.serverTaskAcked || !stillExists(job, actions)) return;
  // 只重试领取确认，不重新生成；第二次失败后交给用户手动重试或下次页面恢复。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await ackNovaTask(job.serverTaskId);
      if (stillExists(job, actions)) {
        const ackedJob = { ...(actions.getJob?.(job.id) || job), serverTaskAcked: true };
        try { await actions.completeJob(job.id, ackedJob); } catch {
          // HTTP 2xx是服务端事实；localStorage/后续元数据写失败不能撤销确认。
          actions.replaceJob(job.id, () => ackedJob);
        }
      }
      return;
    } catch {
      if (attempt === 1 && stillExists(job, actions)) {
        actions.replaceJob(job.id, current => ({
          ...current,
          serverTaskAcked: false,
          warning: '图片已保存到本机，服务器领取确认失败，可重试确认。',
        }));
      }
    }
  }
}

async function finalizeTask(job: StoredJob, task: NovaTaskResponse, actions: SubmitActions): Promise<void> {
  if (!stillExists(job, actions)) return;
  const sourceImages = task.result?.images || [];
  if (task.status !== 'completed' || sourceImages.length === 0) {
    // 已生成的图片过期不应变成“生成失败”，仍保留完成卡片和原始线索。
    if (job.status === 'completed') {
      actions.replaceJob(job.id, current => ({
        ...current,
        localPersistence: current.localPersistence === 'saved' ? 'saved' : 'missing',
        recoveryUnavailable: task.status === 'expired' || task.status === 'failed',
        warning: '服务器临时副本已不可取回；未找到本机副本时无法恢复。',
      }));
    } else {
      await actions.failJob(job.id, task.error || '后端任务失败');
    }
    return;
  }

  const priorImages = job.images || job.recoveryImages || [];
  const preservedIndexes = new Set<number>();
  const images = await Promise.all(sourceImages.map(async (image, index) => {
    const prior = priorImages[index];
    if (!prior) return image;
    const ref = parseStoredBlobRef(prior);
    if (ref && await getStoredBlob(ref.jobId, ref.imageIndex, true)) {
      preservedIndexes.add(index);
      return prior;
    }
    if (prior.startsWith('blob:') && await getStoredBlob(job.id, index, true)) {
      preservedIndexes.add(index);
      return makeStoredBlobRef(job.id, index);
    }
    if (!prior.startsWith('URL:') && !prior.startsWith('MULTI_URL:') && !prior.startsWith('blob:') && !prior.startsWith('IDB:')
      && job.localPersistedIndexes?.includes(index)) {
      preservedIndexes.add(index);
      return prior;
    }
    return image;
  }));
  const preparing: StoredJob = {
    ...job,
    status: 'completed',
    images,
    imageData: images[0],
    recoveryImages: sourceImages,
    serverExpiresAt: task.expiresAt || job.serverExpiresAt,
    localPersistence: 'saving',
    localRecoveryChecked: true,
    serverTaskAcked: false,
    warning: task.warning,
    imageDownloadProgress: createInitialImageDownloadProgress(images),
  };
  // 尽早保存服务器线索；这一步不是领取成功，也不作为ACK依据。
  try { await actions.completeJob(job.id, preparing); } catch { /* 最终提交再判定 */ }
  if (!stillExists(job, actions)) return;
  const result = await downloadAndStoreImages(job.id, images, {
    requirePersistentStorage: true,
    onProgress: item => applyImageDownloadProgress(actions, job.id, images, item),
  });
  if (!stillExists(job, actions)) {
    revokeBlobUrls(result.blobUrls);
    return;
  }
  const finalImages = images.map((image, index) => result.blobUrls[index] || image);
  const localPersistedIndexes = images.map((_, index) => (
    result.persisted?.[index] || preservedIndexes.has(index) ? index : -1
  )).filter(index => index >= 0);
  const allDownloaded = result.failCount === 0 && finalImages.every(image => !image.startsWith('URL:') && !image.startsWith('MULTI_URL:'));
  const finalJob: StoredJob = {
    ...preparing,
    images: finalImages,
    imageData: finalImages[0],
    blobUrls: result.blobUrls.filter(Boolean),
    localPersistence: allDownloaded ? 'saved' : 'temporary',
    localPersistedIndexes,
    imageDownloadProgress: allDownloaded ? undefined : buildImageDownloadProgress(result.items),
    warning: allDownloaded ? task.warning : `${result.failCount} 张图片未保存到本机；当前预览不代表已保存。请重新保存或立即下载，刷新可能丢失。`,
  };
  try {
    // completeJob必须在图片字节校验和任务元数据事务提交之后才resolve。
    await actions.completeJob(job.id, finalJob);
  } catch (error) {
    if (!stillExists(job, actions)) return;
    actions.replaceJob(job.id, current => ({
      ...current,
      ...finalJob,
      localPersistence: 'temporary',
      serverTaskAcked: false,
      warning: `尚未保存到本机：${error instanceof Error ? error.message : '存储失败'}。请重新保存或立即下载，刷新可能丢失。`,
    }));
    return;
  }
  if (allDownloaded && stillExists(job, actions)) await acknowledgeSavedJob(finalJob, actions);
}

export async function finalizeCompletedServerTask(
  job: StoredJob,
  task: NovaTaskResponse,
  actions: SubmitActions,
): Promise<void> {
  const existing = finalizingJobs.get(job.id);
  if (existing) return existing;
  const operation = finalizeTask(job, task, actions);
  finalizingJobs.set(job.id, operation);
  try { await operation; } finally { finalizingJobs.delete(job.id); }
}

export interface RetryDownloadResult {
  successCount: number;
  failCount: number;
  remainingUrlCount: number;
}

/** 只查询已有任务/下载已有图片。绝不调用createNovaTask。 */
export async function retryDownloadCachedImages(job: StoredJob, actions: SubmitActions): Promise<RetryDownloadResult> {
  if (!stillExists(job, actions)) return { successCount: 0, failCount: 0, remainingUrlCount: 0 };
  if (job.localPersistence === 'saved') {
    // 刷新恢复已经校验本机字节；服务端过期不能破坏本机副本。
    try {
      await actions.completeJob(job.id, job);
      await acknowledgeSavedJob(job, actions);
      return { successCount: 0, failCount: 0, remainingUrlCount: 0 };
    } catch {
      // 本机字节可能被用户清理，继续尝试现有任务的临时副本。
    }
  }
  try {
    let task: NovaTaskResponse;
    if (job.serverTaskId) {
      task = await getNovaTask(job.serverTaskId);
    } else {
      const sources = job.recoveryImages || job.images || (job.imageData ? [job.imageData] : []);
      task = { id: job.id, status: 'completed', result: { images: sources } };
    }
    await finalizeCompletedServerTask(job, task, actions);
  } catch (error) {
    if (stillExists(job, actions)) actions.replaceJob(job.id, current => ({
      ...current,
      localRecoveryChecked: true,
      warning: `现有图片取回失败：${error instanceof Error ? error.message : '网络或服务端副本不可用'}；未重新生成。`,
    }));
  }
  const current = actions.getJob?.(job.id);
  const saved = current?.localPersistence === 'saved';
  const remaining = saved ? 0 : (job.recoveryImages?.length || job.images?.length || 1);
  return { successCount: saved ? current?.images?.length || 0 : 0, failCount: remaining, remainingUrlCount: remaining };
}

function resolveImageProviderOrNotify(
  model: string,
  onError: (message: string) => void,
): ReturnType<typeof resolveImageTaskProvider> | null {
  try {
    return resolveImageTaskProvider(model);
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
    return null;
  }
}

export async function submitTextToImage(
  input: TextToImageSubmitInput,
  actions: SubmitActions,
  onError: (message: string) => void
): Promise<boolean> {
  const provider = resolveImageProviderOrNotify(input.model, onError);
  if (!provider) return false;
  const apiKey = provider.apiKey;

  if (!apiKey) {
    onError('请先配置 API 密钥');
    return false;
  }

  for (const prompt of input.prompts) {
    const job = createBaseJob(
      'text-to-image',
      prompt,
      input.outputSize,
      input.customSize,
      input.aspectRatio,
      input.temperature,
      input.model,
      input.gptImageQuality,
      input.gptImageStyle,
      input.gptImageBackground,
      input.parallelCount
    );
    actions.addJob(job);

    try {
      const serverTaskId = await createNovaTask({
        apiKey,
        baseUrl: provider.baseUrl,
        protocol: provider.protocol,
        mode: 'text-to-image',
        prompt,
        outputSize: input.outputSize,
        customSize: input.customSize,
        aspectRatio: input.aspectRatio,
        temperature: input.temperature,
        model: provider.modelId,
        gptImageQuality: input.gptImageQuality,
        gptImageStyle: input.gptImageStyle,
        gptImageBackground: input.gptImageBackground,
        parallelCount: input.parallelCount,
        images: [],
      });

      actions.replaceJob(job.id, current => ({
        ...current,
        status: '排队中',
        serverTaskId,
      }));
    } catch (error) {
      await actions.failJob(job.id, error instanceof Error ? error.message : String(error));
    }
  }
  return true;
}

export async function submitImageToImage(
  input: ImageToImageSubmitInput,
  actions: SubmitActions,
  onError: (message: string) => void
): Promise<boolean> {
  const provider = resolveImageProviderOrNotify(input.model, onError);
  if (!provider) return false;
  const apiKey = provider.apiKey;

  if (!apiKey) {
    onError('请先配置 API 密钥');
    return false;
  }

  const refImages = input.files.map(file => ({
    id: file.id,
    name: file.name,
    dataUrl: file.dataUrl,
    mimeType: file.mimeType,
  }));
  const imageReferences = buildImageReferences(input.files);
  const job = createBaseJob(
    'image-to-image',
    input.prompt,
    input.outputSize,
    input.customSize,
    input.aspectRatio,
    input.temperature,
    input.model,
    input.gptImageQuality,
    input.gptImageStyle,
    input.gptImageBackground,
    input.parallelCount,
    refImages
  );

  actions.addJob(job);

  try {
    const serverTaskId = await createNovaTask({
      apiKey,
      baseUrl: provider.baseUrl,
      protocol: provider.protocol,
      mode: 'image-to-image',
      prompt: input.prompt,
      outputSize: input.outputSize,
      customSize: input.customSize,
      aspectRatio: input.aspectRatio,
      temperature: input.temperature,
      model: provider.modelId,
      gptImageQuality: input.gptImageQuality,
      gptImageStyle: input.gptImageStyle,
      gptImageBackground: input.gptImageBackground,
      parallelCount: input.parallelCount,
      images: imageReferences,
    });

    actions.replaceJob(job.id, current => ({
      ...current,
      status: '排队中',
      serverTaskId,
    }));
  } catch (error) {
    await actions.failJob(job.id, error instanceof Error ? error.message : String(error));
  }
  return true;
}
