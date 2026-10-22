import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceJobs } from '@/hooks/useWorkspaceJobs';
import { loadJobs, restoreJobsFromImages, saveImage, type StoredJob } from '@/lib/job-store';
import { useServerTaskPolling } from '@/hooks/useServerTaskPolling';
import { retryDownloadCachedImages, type SubmitActions } from '@/lib/workspace-task-service';

vi.mock('@/lib/job-store', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/job-store')>(),
  loadJobs: vi.fn(), restoreJobsFromImages: vi.fn(), saveImage: vi.fn(), deleteImage: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/image-downloader', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/image-downloader')>(), deleteStoredBlobs: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/workspace-task-service', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/workspace-task-service')>(), retryDownloadCachedImages: vi.fn().mockResolvedValue({ successCount: 0, failCount: 0, remainingUrlCount: 0 }),
}));
vi.mock('@/lib/ccode-task-socket', () => ({ novaTaskSocket: { subscribeTask: vi.fn(() => vi.fn()) } }));

function job(id = 'old'): StoredJob {
  return { id, status: 'completed', mode: 'text-to-image', prompt: 'test', model: 'test', output_size: '1K', aspect_ratio: '1:1', temperature: 1, created_at: '2026-10-22T00:00:00Z' };
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(loadJobs).mockReturnValue([job()]);
  vi.mocked(restoreJobsFromImages).mockResolvedValue({ jobs: [job()], deletedIds: [] });
  vi.mocked(saveImage).mockReset();
  vi.mocked(saveImage).mockResolvedValue(undefined);
  vi.mocked(retryDownloadCachedImages).mockClear();
});
afterEach(cleanup);

describe('刷新恢复与删除竞争', () => {
  it('延迟恢复失败不能覆盖期间新完成的已保存任务', async () => {
    let failRestore!: (reason: Error) => void;
    vi.mocked(restoreJobsFromImages).mockImplementation(() => new Promise((_resolve, reject) => { failRestore = reject; }));
    const hook = renderHook(() => useWorkspaceJobs());
    const saved = { ...job(), localPersistence: 'saved' as const, images: ['base64'] };
    await act(async () => { await hook.result.current.completeJob('old', saved); });
    await act(async () => { failRestore(new Error('本机读取失败')); });
    expect(hook.result.current.getJob('old')).toBe(saved);
    expect(hook.result.current.getJob('old')?.localPersistence).toBe('saved');
    expect(hook.result.current.getJob('old')?.warning).toBeUndefined();
  });

  it('显式tombstone移除旧localStorage任务但保留恢复期间新任务', async () => {
    let finish!: (result: { jobs: StoredJob[]; deletedIds: string[] }) => void;
    vi.mocked(restoreJobsFromImages).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const hook = renderHook(() => useWorkspaceJobs());
    act(() => hook.result.current.addJob(job('new')));
    await act(async () => finish({ jobs: [], deletedIds: ['old'] }));
    expect(hook.result.current.jobs.map(item => item.id)).toEqual(['new']);
  });

  it('元数据失败时completeJob拒绝，不能提前标记本机已保存', async () => {
    const hook = renderHook(() => useWorkspaceJobs());
    await waitFor(() => expect(restoreJobsFromImages).toHaveBeenCalled());
    vi.mocked(saveImage).mockRejectedValue(new Error('QuotaExceededError'));
    await act(async () => {
      await expect(hook.result.current.completeJob('old', { ...job(), localPersistence: 'saved', images: ['base64'] })).rejects.toThrow('QuotaExceededError');
    });
    expect(hook.result.current.getJob('old')?.localPersistence).toBe('saving');
  });

  it('删除与完成事务竞争不会复活任务', async () => {
    const hook = renderHook(() => useWorkspaceJobs());
    await act(async () => { await Promise.resolve(); });
    let finish!: () => void;
    vi.mocked(saveImage).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    let completion!: Promise<void>;
    act(() => { completion = hook.result.current.completeJob('old', { ...job(), localPersistence: 'saved', images: ['base64'] }); });
    const rejection = expect(completion).rejects.toThrow('已删除');
    await act(async () => {
      await hook.result.current.removeJob('old');
      finish();
      await rejection;
    });
    expect(hook.result.current.hasJob('old')).toBe(false);
    expect(hook.result.current.jobs).toEqual([]);
  });

  it('刷新补取先等本机检查完成，串行上限8条且每条一次', async () => {
    const jobs = Array.from({ length: 10 }, (_, i) => ({ ...job(String(i)), serverTaskId: 'task-' + i, localPersistence: 'missing' as const, localRecoveryChecked: true }));
    const actions: SubmitActions = { addJob: vi.fn(), replaceJob: vi.fn(), completeJob: vi.fn(), failJob: vi.fn(), getJob: id => jobs.find(item => item.id === id) };
    const hook = renderHook(({ list }) => useServerTaskPolling(list, actions, () => true), { initialProps: { list: jobs.map(item => ({ ...item, localRecoveryChecked: false })) } });
    expect(retryDownloadCachedImages).not.toHaveBeenCalled();
    hook.rerender({ list: jobs });
    await waitFor(() => expect(retryDownloadCachedImages).toHaveBeenCalledTimes(8));
    hook.rerender({ list: [...jobs] });
    expect(retryDownloadCachedImages).toHaveBeenCalledTimes(8);
  });
});
