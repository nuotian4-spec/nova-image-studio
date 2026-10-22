import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryJobList } from '@/components/workspace/results/HistoryJobList';
import type { StoredJob } from '@/lib/job-store';
vi.mock('@tanstack/react-virtual', () => ({ useVirtualizer: () => ({ getTotalSize: () => 120, getVirtualItems: () => [{ index: 0, start: 0, lane: 0 }], measureElement: vi.fn() }) }));
vi.mock('@/hooks/useImageLazyLoad', () => ({ useImageLazyLoad: () => ({ elementRef: { current: null }, isVisible: false, isLoaded: false, handleImageLoad: vi.fn() }) }));
vi.mock('@/lib/image-actions', () => ({ copyImagePayload: vi.fn(), dispatchImageActionToast: vi.fn(), runImageAction: vi.fn() }));
afterEach(cleanup);

const base: StoredJob = { id: 'missing', status: 'completed', mode: 'text-to-image', prompt: '生成完成的图片', model: 'test', output_size: '1K', aspect_ratio: '1:1', temperature: 1, created_at: '2026-10-22T00:00:00Z', serverTaskId: 'task', localRecoveryChecked: true, localPersistence: 'missing' };
function show(job: StoredJob) {
  const retry = vi.fn();
  const regenerate = vi.fn();
  render(<HistoryJobList active title="任务" mode="text-to-image" jobs={[job]} loadedImages={new Set()} checkingJobIds={new Set()} cooldowns={new Map()} onRetry={regenerate} onRetryDownload={retry} onClear={vi.fn()} onClearAll={vi.fn()} onCancel={vi.fn()} onCheckStatus={vi.fn()} />);
  return { retry, regenerate };
}

describe('完成但缺图的历史卡片', () => {
  it('没有图片与loadedImages标记仍可见，取回按钮不调用重新生成', () => {
    const { retry, regenerate } = show(base);
    expect(screen.getByTestId('completed-missing-image')).toBeInTheDocument();
    expect(screen.getByText('生成已完成，本机图片缺失。')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '取回已有图片' }));
    expect(retry).toHaveBeenCalledWith(base);
    expect(regenerate).not.toHaveBeenCalled();
  });
  it('读取中保持可见加载状态', () => {
    show({ ...base, localRecoveryChecked: false });
    expect(screen.getByText('正在读取本机图片…')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取回已有图片' })).not.toBeInTheDocument();
  });
  it('两处副本均不存在时卡片显示缺失原因，不承诺恢复', () => {
    show({ ...base, recoveryUnavailable: true, warning: '服务器临时副本已不可取回；未找到本机副本时无法恢复。' });
    expect(screen.getByText(/无法恢复/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '取回已有图片' })).not.toBeInTheDocument();
  });
});
