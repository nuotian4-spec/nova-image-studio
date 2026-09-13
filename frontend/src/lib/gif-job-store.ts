import { withBasePath } from '@/lib/embed/public-path';
import type { RefImageData } from '@/lib/job-store';
import { supportsCustomSize, type GptImageBackground, type GptImageQuality, type GptImageStyle } from '@/lib/model-capabilities';
import { getDefaultImageModel, getCompleteImageModels, loadRegistry } from '@/lib/nova-models';

export type GifModel = string;

export type GifStatus =
  | 'idle'
  | 'generating_grid'
  | 'review_grid'
  | 'generating_gif'
  | 'done'
  | 'failed';

export interface ActiveGifJob {
  id: string;
  status: GifStatus;
  prompt: string;
  loop: boolean;
  closedLoop: boolean;
  model: string;
  gptImageQuality?: GptImageQuality;
  gptImageStyle?: GptImageStyle;
  gptImageBackground?: GptImageBackground;
  refImages: RefImageData[];
  serverTaskId?: string;
  gridImageRef?: string;
  frameDelayMs: number;
  loopCount: number;
  framePadding: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = 'nova-gif-active-job';
/** 嵌入态必须带 basePath；裸 '/togif.png' 会打到父站根路径，被 SPA fallback 回成 HTML。 */
const TEMPLATE_URL = withBasePath('/togif.png');

export const GIF_MAX_REF_IMAGES = 6;
export const GIF_DEFAULT_FRAME_DELAY_MS = 120;
export const GIF_DEFAULT_LOOP_COUNT = 0;
export const GIF_DEFAULT_FRAME_PADDING = 1.5;
export const GIF_MAX_FRAME_PADDING = 5;
/** OpenAI Images 合法横图；禁止再用 3264x2448（上游不认）。 */
export const GIF_GRID_CUSTOM_SIZE = '1536x1024';
export const GIF_GRID_OUTPUT_SIZE = '2K' as const;
export const GIF_GRID_ASPECT_RATIO = '4:3' as const;
export const GIF_GRID_COLS = 4;
export const GIF_GRID_ROWS = 3;
export const GIF_FRAME_COUNT = GIF_GRID_COLS * GIF_GRID_ROWS;

export function loadActiveGifJob(): ActiveGifJob | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ActiveGifJob;
    if (!parsed || typeof parsed.id !== 'string' || !parsed.status) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveActiveGifJob(job: ActiveGifJob | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (!job) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(job));
  } catch {
    // storage quota / privacy mode — keep working with in-memory state only
  }
}

let cachedTemplate: { data: string; mimeType: string } | null = null;
let inflightTemplate: Promise<{ data: string; mimeType: string }> | null = null;

const HTML_TEMPLATE_ERROR = '排版模板图内容不是图片（疑似父站 HTML 回退），禁止当 PNG 上传';

function isImageContentType(value: string): boolean {
  const mime = value.split(';')[0].trim().toLowerCase();
  return mime.startsWith('image/');
}

/** 父站 SPA fallback 常返回 <!DOCTYPE html> / <html>，不能当 PNG 送给 edits。 */
function looksLikeHtmlPrefix(raw: string): boolean {
  const head = raw.replace(/^\uFEFF/, '').trimStart().slice(0, 64).toLowerCase();
  return head.startsWith('<!doctype') || head.startsWith('<html');
}

async function blobToBase64(blob: Blob): Promise<string> {
  // arrayBuffer 兼容 fetch 的 Blob 实现；jsdom FileReader 不认 undici Blob。
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  try {
    return btoa(binary);
  } catch {
    throw new Error('读取模板图失败');
  }
}

async function assertGifTemplateIsImage(response: Response, blob: Blob): Promise<void> {
  const declaredType = response.headers.get('content-type') || blob.type || '';
  if (declaredType && !isImageContentType(declaredType)) {
    throw new Error(HTML_TEMPLATE_ERROR);
  }
  const sniff = await blob.slice(0, 512).text();
  if (looksLikeHtmlPrefix(sniff)) {
    throw new Error(HTML_TEMPLATE_ERROR);
  }
}

/** 仅测试用：失败/串测不得把 HTML 或旧结果留在模块缓存里。 */
export function resetGifTemplateCacheForTests(): void {
  cachedTemplate = null;
  inflightTemplate = null;
}

export async function loadGifTemplate(): Promise<{ data: string; mimeType: string }> {
  if (cachedTemplate) return cachedTemplate;
  if (inflightTemplate) return inflightTemplate;

  inflightTemplate = (async () => {
    try {
      const response = await fetch(TEMPLATE_URL, { cache: 'force-cache' });
      if (!response.ok) {
        throw new Error(`无法加载排版模板图 (${response.status})`);
      }
      const blob = await response.blob();
      await assertGifTemplateIsImage(response, blob);
      const data = await blobToBase64(blob);
      const result = { data, mimeType: blob.type || 'image/png' };
      cachedTemplate = result;
      return result;
    } catch (error) {
      cachedTemplate = null;
      throw error;
    } finally {
      inflightTemplate = null;
    }
  })();

  return inflightTemplate;
}

export function isActiveStatus(status: GifStatus): boolean {
  return status === 'generating_grid' || status === 'generating_gif';
}

export function needsOverwriteConfirm(job: ActiveGifJob | null): boolean {
  if (!job) return false;
  return job.status !== 'idle';
}

export type GifGridOutputSize = '1K' | '2K' | '4K';

export interface GifGridSizeParams {
  outputSize: GifGridOutputSize;
  customSize?: string;
  aspectRatio: typeof GIF_GRID_ASPECT_RATIO;
}

function findCompleteImageModel(modelId: string) {
  const models = getCompleteImageModels(loadRegistry());
  return models.find((item) => item.id === modelId)
    || models.find((item) => item.modelId === modelId)
    || models.find((item) => item.name === modelId);
}

function toGifGridOutputSize(maxOutputSize: string | undefined): GifGridOutputSize {
  if (maxOutputSize === '4K' || maxOutputSize === '2K' || maxOutputSize === '1K') {
    return maxOutputSize;
  }
  return '1K';
}

/** OpenAI 自定义尺寸模型用官方合法横图；其余模型不传 customSize，改用声明的最大输出档。 */
export function resolveGifGridSizeParams(modelId: string): GifGridSizeParams {
  const model = findCompleteImageModel(modelId);
  const capabilityId = model?.id || modelId;
  if (supportsCustomSize(capabilityId)) {
    return {
      outputSize: GIF_GRID_OUTPUT_SIZE,
      customSize: GIF_GRID_CUSTOM_SIZE,
      aspectRatio: GIF_GRID_ASPECT_RATIO,
    };
  }
  return {
    outputSize: toGifGridOutputSize(model?.maxOutputSize),
    aspectRatio: GIF_GRID_ASPECT_RATIO,
  };
}

export function getGifCompatibleModels(): { value: GifModel; label: string }[] {
  const registry = loadRegistry();
  return getCompleteImageModels(registry).map((model) => ({
    value: model.id,
    label: model.name,
  }));
}

export function getDefaultGifModelId(): GifModel {
  const registry = loadRegistry();
  const options = getGifCompatibleModels();
  const preferred = getDefaultImageModel(registry, 'textToImage');
  if (preferred && options.some((option) => option.value === preferred.id)) {
    return preferred.id;
  }
  return options[0]?.value || '';
}
