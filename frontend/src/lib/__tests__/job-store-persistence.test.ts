import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deleteImage, loadJobs, restoreJobsFromImages, saveImage, saveJobs, type StoredJob } from '@/lib/job-store';
import { openImageDb } from '@/lib/image-db';
import { getStoredBlob, storeImageBlobForWorkspace } from '@/lib/image-downloader';

vi.mock('@/lib/image-db', () => ({
  openImageDb: vi.fn(), IMG_STORE: 'images', BLOBS_STORE: 'blobs',
}));

const mockOpen = vi.mocked(openImageDb);
type RecordValue = Record<string, unknown>;
type Fault = { store: string; event: 'error' | 'abort' | 'throw'; name: string };

/** 事务替身保留提交/中止边界，故障注入覆盖真实代码的事件处理，禁止提前发布写入。 */
function database(fault?: Fault) {
  const rows: Record<string, Map<string, RecordValue>> = { images: new Map(), blobs: new Map() };
  const events: string[] = [];
  const db = {
    objectStoreNames: { contains: (name: string) => name in rows },
    transaction: (_names: string | string[], mode: string) => {
      let pending = 0;
      let stopped = false;
      const writes: Array<() => void> = [];
      const tx = {
        error: null as DOMException | null,
        oncomplete: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onabort: null as (() => void) | null,
        abort() {
          if (stopped) return;
          stopped = true;
          queueMicrotask(() => tx.onabort?.());
        },
        objectStore(name: string) {
          const request = (value: () => unknown) => {
            pending++;
            const req = { result: undefined as unknown, onsuccess: null as (() => void) | null, onerror: null as (() => void) | null };
            queueMicrotask(() => {
              if (stopped) return;
              req.result = value();
              req.onsuccess?.();
              pending--;
              finish();
            });
            return req;
          };
          return {
            get: (key: string) => request(() => rows[name].get(key)),
            getAll: () => request(() => Array.from(rows[name].values())),
            put(value: RecordValue) {
              if (fault?.store === name) {
                const error = new DOMException('本机存储失败', fault.name);
                if (fault.event === 'throw') throw error;
                pending++;
                queueMicrotask(() => {
                  if (stopped) return;
                  stopped = true;
                  tx.error = error;
                  if (fault.event === 'error') tx.onerror?.();
                  else tx.onabort?.();
                });
              } else {
                writes.push(() => rows[name].set(String(value.id || value.key), value));
              }
            },
            openCursor: () => request(() => null),
          };
        },
      };
      const finish = () => queueMicrotask(() => {
        if (pending || stopped) return;
        stopped = true;
        writes.forEach(write => write());
        events.push(mode === 'readwrite' ? 'committed' : 'read');
        tx.oncomplete?.();
      });
      finish();
      return tx;
    },
  };
  mockOpen.mockResolvedValue(db as unknown as IDBDatabase);
  return { rows, events };
}

function job(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 'persistence-job', mode: 'text-to-image', status: 'completed', prompt: '测试图片',
    output_size: '1K', aspect_ratio: '1:1', temperature: 1, model: 'test', created_at: '2026-10-22T00:00:00Z',
    images: ['IDB:persistence-job-0'], localPersistence: 'saved', ...overrides,
  };
}

beforeEach(() => { mockOpen.mockReset(); localStorage.clear(); vi.restoreAllMocks(); });

describe('图片字节与可恢复元数据提交边界', () => {
  it('IndexedDB不可用时saveImage明确失败', async () => {
    mockOpen.mockResolvedValue(null);
    await expect(saveImage(job())).rejects.toThrow('不可用');
  });

  it.each([
    ['error', 'UnknownError'], ['abort', 'AbortError'], ['error', 'QuotaExceededError'], ['throw', 'QuotaExceededError'],
  ] as const)('blob写入%s/%s失败不能宣称持久成功', async (event, name) => {
    database({ store: 'blobs', event, name });
    await expect(storeImageBlobForWorkspace('failed-blob', 0, new Blob(['x']))).rejects.toBeTruthy();
    await expect(getStoredBlob('failed-blob', 0, true)).resolves.toBeNull();
  });

  it.each(['error', 'abort'] as const)('blob成功、metadata%s失败，不能完成提交', async event => {
    const db = database({ store: 'images', event, name: 'QuotaExceededError' });
    db.rows.blobs.set('persistence-job-0', { blob: new Blob(['x']) });
    await expect(saveImage(job())).rejects.toBeTruthy();
    expect(db.rows.images.has('persistence-job')).toBe(false);
  });

  it('元数据写前核验每张图片字节，无字节则中止', async () => {
    const db = database();
    await expect(saveImage(job())).rejects.toThrow('字节缺失');
    expect(db.rows.images.size).toBe(0);
  });

  it('完整事务后记录能独立恢复，localStorage失败不孤儿、服务器过期不影响本机', async () => {
    const db = database();
    db.rows.blobs.set('persistence-job-0', { blob: new Blob(['x']) });
    const original = job({ serverExpiresAt: '2020-01-01T00:00:00Z', serverTaskAcked: true });
    await saveImage(original);
    expect(db.events).toEqual(['committed']);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    saveJobs([original]);
    expect(loadJobs()).toEqual([]);
    const restored = await restoreJobsFromImages([]);
    expect(restored.jobs).toHaveLength(1);
    expect(restored.jobs[0]).toMatchObject({ id: original.id, prompt: original.prompt, localPersistence: 'saved', serverTaskAcked: true });
    spy.mockRestore();
  });

  it('旧images记录与旧localStorage索引兼容', async () => {
    const db = database();
    db.rows.images.set('persistence-job', { id: 'persistence-job', images: ['base64-image'] });
    const restored = await restoreJobsFromImages([job({ images: undefined, localPersistence: undefined })]);
    expect(restored.jobs[0]).toMatchObject({ prompt: '测试图片', images: ['base64-image'], localPersistence: 'saved' });
  });

  it('部分图保存只存持久槽引用与远端恢复线索，不能把内存blob写成IDB成功', async () => {
    const db = database();
    db.rows.blobs.set('persistence-job-0', { blob: new Blob(['x']) });
    await saveImage(job({ localPersistence: 'temporary', images: ['blob:good', 'blob:temporary'], localPersistedIndexes: [0], recoveryImages: ['URL:/0', 'URL:/1'] }));
    expect(db.rows.images.get('persistence-job')?.images).toEqual(['IDB:persistence-job-0', 'URL:/1']);
  });

  it('删除tombstone阻止晚到完成写入且过滤另一标签旧索引', async () => {
    const db = database();
    await deleteImage('persistence-job');
    await expect(saveImage(job())).rejects.toThrow('已删除');
    const restored = await restoreJobsFromImages([job()]);
    expect(restored.jobs).toEqual([]);
    expect(restored.deletedIds).toEqual(['persistence-job']);
    expect(db.rows.images.get('persistence-job')?.deleted).toBe(true);
  });
});
