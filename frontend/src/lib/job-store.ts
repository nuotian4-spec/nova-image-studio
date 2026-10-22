import type { GptImageBackground, GptImageQuality, GptImageStyle } from '@/lib/model-capabilities';
import { getStoredBlob, makeStoredBlobRef, parseStoredBlobRef, type ImageDownloadProgressItem } from '@/lib/image-downloader';
import { openImageDb, IMG_STORE, BLOBS_STORE } from '@/lib/image-db';

export type Mode = 'text-to-image' | 'image-to-image' | 'prompt-gallery';
export type OutputSize = 'auto' | '512' | '1K' | '2K' | '4K';
export type AspectRatio = 'auto' | '1:1' | '1:4' | '1:8' | '2:3' | '3:2' | '3:4' | '4:1' | '4:3' | '4:5' | '5:4' | '8:1' | '9:16' | '16:9' | '21:9';

export interface RefImageData {
  id: string;
  name: string;
  dataUrl: string;
  mimeType: string;
  badge?: string;
}

export interface ImageDownloadProgress {
  total: number;
  completed: number;
  failed: number;
  items: ImageDownloadProgressItem[];
}

export interface StoredJob {
  id: string;
  status: 'queued' | '排队中' | 'processing' | 'completed' | 'failed';
  mode: Mode;
  prompt: string;
  output_size: OutputSize;
  custom_size?: string;
  temperature: number;
  aspect_ratio: AspectRatio;
  model: string;
  gptImageQuality?: GptImageQuality;
  gptImageStyle?: GptImageStyle;
  gptImageBackground?: GptImageBackground;
  created_at: string;
  error?: string;
  networkError?: boolean;
  /** true 表示后端明确判定该失败任务不可恢复（API 错误 / 服务器重启 / 已过期 / 已删除）。
   * 仅在 status==='failed' 时有意义；undefined 视为非终态，允许"查看进度" */
  terminal?: boolean;
  warning?: string;
  imageData?: string;
  parallelCount?: number;
  images?: string[];
  serverTaskId?: string;
  serverTaskAcked?: boolean;
  localPersistence?: 'saving' | 'saved' | 'temporary' | 'missing';
  localRecoveryChecked?: boolean;
  recoveryImages?: string[];
  localPersistedIndexes?: number[];
  serverExpiresAt?: string;
  recoveryUnavailable?: boolean;
  refImages?: RefImageData[];
  originalPrompt?: string;
  blobUrls?: string[];
  imageDownloadProgress?: ImageDownloadProgress;
}

const JOBS_KEY = 'nova-jobs';

// 复用单例连接层；保留这两个导出名以兼容现有调用方（如 useWorkspaceJobs）。
export { IMG_STORE };
export const openDB = openImageDb;

export function getImageSrc(imageData: string): string {
  if (imageData.startsWith('blob:')) {
    return imageData;
  }

  if (imageData.startsWith('URL:')) {
    return imageData.substring(4);
  }

  if (imageData.startsWith('MULTI_URL:')) {
    return imageData.substring(10).split('|||')[0];
  }

  if (imageData.startsWith('IDB:')) {
    return '';
  }

  return `data:image/png;base64,${imageData}`;
}

function toPersistedImageRefs(result: StoredJob): string[] | undefined {
  return result.images?.map((image, index) => (
    image.startsWith('blob:')
      ? result.localPersistence !== 'saved' && !result.localPersistedIndexes?.includes(index) && result.recoveryImages?.[index]
        ? result.recoveryImages[index]
        : makeStoredBlobRef(result.id, index)
      : image
  ));
}

export async function saveImage(result: StoredJob) {
  const db = await openDB();
  if (!db) throw new Error('浏览器本机图片存储不可用');

  const images = toPersistedImageRefs(result);

  return new Promise<void>((resolve, reject) => {
    // 与blobs放在同一事务：检查字节与提交可恢复记录之间不能夹入删除事务。
    const tx = db.transaction([IMG_STORE, BLOBS_STORE], 'readwrite');
    let failure: Error | undefined;
    const abort = (message: string) => {
      failure = new Error(message);
      tx.abort();
    };
    const record = {
      ...result,
      schema: 'workspace-job-v1',
      imageData: images?.[0] || result.imageData,
      images,
      blobUrls: undefined,
      imageDownloadProgress: undefined,
      localRecoveryChecked: undefined,
    };
    const metadata = tx.objectStore(IMG_STORE);
    const writeRecord = () => {
      try { metadata.put(record); } catch (error) {
        failure = error instanceof Error ? error : new Error('本机图片记录保存失败');
        tx.abort();
      }
    };
    const prior = metadata.get(result.id);
    prior.onsuccess = () => {
      if (prior.result?.deleted) {
        abort('任务已删除，停止保存');
        return;
      }
      if (result.localPersistence !== 'saved') {
        const partialRefs = images || (result.imageData ? [result.imageData] : []);
        const storedIndexes = result.localPersistedIndexes || [];
        const storedRefs = partialRefs
          .map((ref, index) => storedIndexes.includes(index) ? parseStoredBlobRef(ref) : null)
          .filter(ref => ref !== null);
        let remaining = storedRefs.length;
        if (!remaining) writeRecord();
        for (const ref of storedRefs) {
          const request = tx.objectStore(BLOBS_STORE).get(`${ref.jobId}-${ref.imageIndex}`);
          request.onsuccess = () => {
            if (!request.result?.blob) {
              abort('本机图片字节缺失，未确认领取');
              return;
            }
            remaining--;
            if (remaining === 0) writeRecord();
          };
        }
        return;
      }
      const refs = images || (result.imageData ? [result.imageData] : []);
      if (!refs.length || refs.some(ref => ref.startsWith('URL:') || ref.startsWith('MULTI_URL:') || ref.startsWith('blob:'))) {
        abort('图片尚未全部保存到本机');
        return;
      }
      const storedRefs = refs.map(parseStoredBlobRef).filter(ref => ref !== null);
      let remaining = storedRefs.length;
      if (!remaining) writeRecord();
      for (const ref of storedRefs) {
        const request = tx.objectStore(BLOBS_STORE).get(`${ref.jobId}-${ref.imageIndex}`);
        request.onsuccess = () => {
          if (!request.result?.blob) {
            abort('本机图片字节缺失，未确认领取');
            return;
          }
          remaining--;
          if (remaining === 0) writeRecord();
        };
      }
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(failure || tx.error || new Error('本机图片记录保存失败'));
    tx.onabort = () => reject(failure || tx.error || new Error('本机图片记录保存事务已中止'));
  });
}

export interface StoredImageRecord extends StoredJob {
  schema?: 'workspace-job-v1';
  deleted?: boolean;
}

export async function loadImageRecords(): Promise<StoredImageRecord[]> {
  const db = await openDB();
  if (!db) throw new Error('浏览器本机图片存储不可用');
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IMG_STORE, 'readonly');
    const request = tx.objectStore(IMG_STORE).getAll();
    tx.oncomplete = () => resolve(request.result || []);
    tx.onerror = () => reject(tx.error || new Error('本机图片记录读取失败'));
    tx.onabort = () => reject(tx.error || new Error('本机图片记录读取已中止'));
  });
}

/** 旧记录仍靠nova-jobs补足信息；新记录可独立恢复，避免localStorage写失败形成孤儿。 */
export async function restoreJobsFromImages(jobs: StoredJob[]): Promise<{ jobs: StoredJob[]; deletedIds: string[] }> {
  const records = await loadImageRecords();
  const deleted = new Set(records.filter(record => record.deleted).map(record => record.id));
  const merged = new Map(jobs.filter(job => !deleted.has(job.id)).map(job => [job.id, job]));
  for (const record of records) {
    if (record.deleted) continue;
    const current = merged.get(record.id);
    if (current || record.schema === 'workspace-job-v1') {
      merged.set(record.id, {
        ...current,
        ...record,
        // 本版仅在ACK 2xx后写true；兼容保留旧版标记，但不据此证明图片已持久化。
        serverTaskAcked: current?.serverTaskAcked || record.serverTaskAcked,
      });
    }
  }
  const restored = await Promise.all(Array.from(merged.values()).map(async job => {
    if (job.status !== 'completed') return job;
    const images = job.images || (job.imageData ? [job.imageData] : []);
    const availability = await Promise.all(images.map(async (image, index) => {
      const ref = parseStoredBlobRef(image);
      if (ref || image.startsWith('blob:')) {
        return !!await getStoredBlob(ref?.jobId || job.id, ref?.imageIndex ?? index, true);
      }
      return !!image && !image.startsWith('URL:') && !image.startsWith('MULTI_URL:');
    }));
    const saved = images.length > 0 && availability.every(Boolean);
    return {
      ...job,
      localRecoveryChecked: true,
      localPersistence: saved ? 'saved' as const : 'missing' as const,
      warning: saved ? job.warning : '本机图片未完整保存，可尝试取回仍未过期的服务器临时副本。',
    };
  }));
  return { jobs: restored, deletedIds: Array.from(deleted) };
}

export async function deleteImage(jobId: string) {
  const db = await openDB();
  if (!db) return;

  return new Promise<void>((resolve) => {
    const tx = db.transaction([IMG_STORE, BLOBS_STORE], 'readwrite');
    const images = tx.objectStore(IMG_STORE);
    const blobs = tx.objectStore(BLOBS_STORE);
    // tombstone阻止另一个标签页或晚到下载把用户删除的任务重新写回来。
    images.put({ id: jobId, deleted: true, deletedAt: Date.now() });
    const request = blobs.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(`${jobId}-`)) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function loadJobs(): StoredJob[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(JOBS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveJobs(jobs: StoredJob[]) {
  if (typeof window === 'undefined') return;

  const lightweight = jobs.map(({ ...job }) => {
    delete job.imageData;
    delete job.images;
    delete job.refImages;
    delete job.blobUrls;
    delete job.imageDownloadProgress;
    delete job.localRecoveryChecked;
    return job;
  });
  try {
    localStorage.setItem(JOBS_KEY, JSON.stringify(lightweight));
  } catch {
    // Keep the in-memory job list usable when storage quota or browser policy blocks writes.
  }
}
