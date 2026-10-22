import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hasAnyApiKey, hasImageApiKey, hasTextApiKey } from '@/lib/settings-storage';
import {
  deleteImage,
  loadJobs,
  restoreJobsFromImages,
  saveImage,
  saveJobs,
  type Mode,
  type StoredJob,
} from '@/lib/job-store';
import type { ModelId } from '@/lib/gemini-config';
import { getCompatibleRetryData, type RetryData } from '@/lib/model-capabilities';
import { classifyFailureFromMessage } from '@/lib/task-failure';
import { deleteStoredBlobs, revokeBlobUrls } from '@/lib/image-downloader';
import { retryDownloadCachedImages } from '@/lib/workspace-task-service';

function isWaitingJob(job: StoredJob): boolean {
  return job.status === 'processing' || job.status === 'queued' || job.status === '排队中';
}

function loadInitialJobs(): StoredJob[] {
  return loadJobs().map(job => ({
    ...job,
    ...(isWaitingJob(job) && !job.serverTaskId ? { status: 'failed' as const, error: '页面刷新，任务已中断', terminal: true } : {}),
    ...(!job.model ? { model: 'gemini-3-pro-image-preview' as ModelId } : {}),
  }));
}

export function useWorkspaceJobs() {
  const [hasApiKey, setHasApiKey] = useState(() => hasAnyApiKey());
  const [hasImageKey, setHasImageKey] = useState(() => hasImageApiKey());
  const [hasTextKey, setHasTextKey] = useState(() => hasTextApiKey());
  const [jobs, setJobs] = useState<StoredJob[]>(loadInitialJobs);
  const jobsRef = useRef(jobs);
  const removedIdsRef = useRef(new Set<string>());
  const [loadedImages, setLoadedImages] = useState<Set<string>>(new Set());
  const [retryData, setRetryData] = useState<RetryData | null>(null);
  const [clearAllDialogOpen, setClearAllDialogOpen] = useState<Mode | null>(null);
  const [cancelJobId, setCancelJobId] = useState<string | null>(null);

  useEffect(() => {
    const refreshKeys = () => {
      setHasApiKey(hasAnyApiKey());
      setHasImageKey(hasImageApiKey());
      setHasTextKey(hasTextApiKey());
    };
    window.addEventListener('nova-model-registry-updated', refreshKeys);
    return () => window.removeEventListener('nova-model-registry-updated', refreshKeys);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const initialJobs = jobsRef.current;
    const initialById = new Map(initialJobs.map(job => [job.id, job]));
    void restoreJobsFromImages(initialJobs).then(restored => {
      if (cancelled) return;
      const current = new Map(jobsRef.current.map(job => [job.id, job]));
      for (const id of restored.deletedIds) {
        removedIdsRef.current.add(id);
        current.delete(id);
      }
      for (const job of restored.jobs) {
        if (removedIdsRef.current.has(job.id)) continue;
        const live = current.get(job.id);
        // 恢复旧副本不能覆盖本轮已经完成的新写入。
        if (live === initialById.get(job.id) && !live?.localRecoveryChecked) {
          const merged = { ...live, ...job, serverTaskAcked: live?.serverTaskAcked || job.serverTaskAcked };
          current.set(job.id, merged);
        }
      }
      const next = Array.from(current.values()).filter(job => !removedIdsRef.current.has(job.id));
      jobsRef.current = next;
      setJobs(next);
      saveJobs(next);
      setLoadedImages(new Set(next.filter(job => job.status === 'completed').map(job => job.id)));
    }).catch(() => {
      if (cancelled) return;
      const next = jobsRef.current.map(job => job.status === 'completed' && job === initialById.get(job.id) && !job.localRecoveryChecked ? {
        ...job,
        localRecoveryChecked: true,
        localPersistence: 'missing' as const,
        warning: '浏览器本机存储不可用；请取回现有图片并立即下载，刷新可能丢失。',
      } : job);
      jobsRef.current = next;
      setJobs(next);
    });
    return () => { cancelled = true; };
  }, []);

  const persistJobs = useCallback((updater: (prev: StoredJob[]) => StoredJob[]) => {
    // 立即推进异步读取快照，避免下载完成与删除在React批处理之间读取旧列表。
    const next = updater(jobsRef.current);
    jobsRef.current = next;
    saveJobs(next);
    setJobs(next);
  }, []);

  const addJob = useCallback((job: StoredJob) => {
    persistJobs(prev => [job, ...prev]);
  }, [persistJobs]);

  const replaceJob = useCallback((jobId: string, updater: (job: StoredJob) => StoredJob) => {
    persistJobs(prev => prev.map(job => (job.id === jobId ? updater(job) : job)));
  }, [persistJobs]);

  const hasJob = useCallback((jobId: string) => {
    return jobsRef.current.some(job => job.id === jobId);
  }, []);

  // 返回最新的 job 快照（来自 jobsRef），供异步回调避免捕获过期闭包。
  const getJob = useCallback((jobId: string) => {
    return jobsRef.current.find(job => job.id === jobId);
  }, []);

  const completeJob = useCallback(async (jobId: string, job: StoredJob) => {
    if (removedIdsRef.current.has(jobId) || !jobsRef.current.some(current => current.id === jobId)) {
      throw new Error('任务已删除，停止保存');
    }
    // 允许当前页面先预览，但“已保存”必须等持久事务提交。
    const preview = job.localPersistence === 'saved' ? { ...job, localPersistence: 'saving' as const } : job;
    persistJobs(prev => prev.map(current => current.id === jobId ? preview : current));
    setLoadedImages(prev => new Set(prev).add(jobId));
    await saveImage(job);
    if (removedIdsRef.current.has(jobId) || !jobsRef.current.some(current => current.id === jobId)) {
      await deleteImage(jobId);
      throw new Error('任务已删除，停止保存');
    }
    persistJobs(prev => prev.map(current => current.id === jobId ? job : current));
  }, [persistJobs]);

  const failJob = useCallback(async (jobId: string, error: string, options?: { terminal?: boolean }) => {
    let failedJob: StoredJob | null = null;
    persistJobs(prev => prev.map(job => {
      if (job.id !== jobId) return job;
      const classification = classifyFailureFromMessage(error);
      const terminal = options?.terminal ?? classification.terminal;
      failedJob = {
        ...job,
        status: 'failed',
        error,
        networkError: classification.reason === 'network',
        terminal,
      };
      return failedJob;
    }));

    if (failedJob) {
      await saveImage(failedJob).catch(() => undefined);
    }
  }, [persistJobs]);

  const removeJob = useCallback(async (jobId: string) => {
    const removedJob = jobsRef.current.find(job => job.id === jobId);
    removedIdsRef.current.add(jobId);
    if (removedJob?.blobUrls) {
      revokeBlobUrls(removedJob.blobUrls);
    }
    persistJobs(prev => prev.filter(job => job.id !== jobId));
    setLoadedImages(prev => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
    await Promise.all([
      deleteImage(jobId).catch(() => undefined),
      deleteStoredBlobs(jobId, removedJob?.images?.length).catch(() => undefined),
    ]);
  }, [persistJobs]);

  const clearJobsByMode = useCallback(async (modeFilter: Mode) => {
    const toRemove = jobsRef.current.filter(job => job.mode === modeFilter);
    if (toRemove.length === 0) {
      setClearAllDialogOpen(null);
      return;
    }

    for (const job of toRemove) {
      removedIdsRef.current.add(job.id);
      if (job.blobUrls) {
        revokeBlobUrls(job.blobUrls);
      }
    }
    persistJobs(prev => prev.filter(job => job.mode !== modeFilter));
    setLoadedImages(prev => {
      const next = new Set(prev);
      for (const job of toRemove) {
        next.delete(job.id);
      }
      return next;
    });

    await Promise.all(toRemove.flatMap(job => [
      deleteImage(job.id).catch(() => undefined),
      deleteStoredBlobs(job.id, job.images?.length).catch(() => undefined),
    ]));
    setClearAllDialogOpen(null);
  }, [persistJobs]);

  const textJobs = useMemo(
    () => jobs.filter(job => job.mode === 'text-to-image').sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [jobs]
  );
  const imageJobs = useMemo(
    () => jobs.filter(job => job.mode === 'image-to-image').sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [jobs]
  );

  const retryJob = useCallback((job: StoredJob) => {
    setRetryData(getCompatibleRetryData(job));
  }, []);

  /**
   * "重新下载"按钮回调：尝试把 URL: 引用的图片缓存到本地 IndexedDB。
   * 成功 → 清空 warning 并 ack 服务端任务；失败 → 保持现状，UI 仍显示 warning。
   * 不抛错；调用方（按钮）通过本地 retrying 状态显示 spinner，无需感知错误细节。
   */
  const retryDownload = useCallback(async (job: StoredJob) => {
    try {
      await retryDownloadCachedImages(job, {
        addJob,
        replaceJob,
        completeJob,
        failJob,
        getJob,
      });
    } catch {
      // retryDownload failure is non-critical
    }
  }, [addJob, replaceJob, completeJob, failJob, getJob]);

  return {
    hasApiKey,
    hasImageKey,
    hasTextKey,
    jobs,
    textJobs,
    imageJobs,
    loadedImages,
    retryData,
    clearAllDialogOpen,
    cancelJobId,
    setHasApiKey: (hasKey: boolean) => {
      setHasApiKey(hasKey);
      setHasImageKey(hasImageApiKey());
      setHasTextKey(hasTextApiKey());
    },
    setRetryData,
    setClearAllDialogOpen,
    setCancelJobId,
    retryJob,
    retryDownload,
    hasJob,
    getJob,
    addJob,
    replaceJob,
    completeJob,
    failJob,
    removeJob,
    clearJobsByMode,
  };
}
