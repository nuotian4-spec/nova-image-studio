import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enableEmbeddedModeForTests, resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import { SliceWorkspace } from '../SliceWorkspace';
import { useSliceStore } from '../stores/use-slice-store';

vi.mock('@/components/agent/AgentAssetPickerDialog', () => ({
  AgentAssetPickerDialog: () => null,
}));

describe('SliceWorkspace 嵌入窄屏', () => {
  beforeEach(() => {
    resetEmbedRuntimeForTests();
    useSliceStore.setState({
      hydrated: true,
      workspaces: [],
      activeWorkspaceId: null,
      activeWorkspace: null,
      hydrate: async () => {},
    });
  });

  afterEach(() => {
    cleanup();
    resetEmbedRuntimeForTests();
  });

  it('独立站 wideMode=false 仍显示宽屏门', async () => {
    render(
      <SliceWorkspace
        wideMode={false}
        onConfigureApiKey={() => undefined}
        onEnableWideMode={() => undefined}
        showToast={() => undefined}
      />,
    );
    expect(await screen.findByText('UI设计模式需要宽屏模式')).toBeInTheDocument();
    expect(screen.queryByText('开始新工作')).not.toBeInTheDocument();
    expect(screen.queryByText(/布局较挤/)).not.toBeInTheDocument();
  });

  it('嵌入 iframe 1100 宽时不再只显示宽屏门，工作区可进', async () => {
    enableEmbeddedModeForTests();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1100 });
    render(
      <SliceWorkspace
        wideMode={false}
        onConfigureApiKey={() => undefined}
        onEnableWideMode={() => undefined}
        showToast={() => undefined}
      />,
    );
    expect(screen.queryByText('UI设计模式需要宽屏模式')).not.toBeInTheDocument();
    expect(screen.getByText(/布局较挤，可用父站/)).toBeInTheDocument();
    expect(screen.getByText(/新窗口打开/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('开始新工作')).toBeInTheDocument();
    });
    expect(screen.getByText('UI设计模式')).toBeInTheDocument();
  });
});
