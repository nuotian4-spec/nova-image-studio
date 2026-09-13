import type { ComponentProps } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { GifGenerationWorkspace } from '../GifGenerationWorkspace';
import { ingestParentStudioMessage } from '@/lib/embed/apply-parent';
import { enableEmbeddedModeForTests, resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import { getGifCompatibleModels } from '@/lib/gif-job-store';
import { DEFAULT_DEFAULTS, saveRegistry, type NovaModelRegistry } from '@/lib/nova-models';
import { syncDynamicModelExports } from '@/lib/gemini-config';
import type { ParentNovaStudioConfig } from '@/lib/embed/protocol-map';

const PARENT_BASE = 'https://parent.example/';

vi.mock('@/hooks/useGifWorkflow', () => ({
  useGifWorkflow: () => ({
    job: null,
    gridImageUrl: null,
    gifBlob: null,
    gifReady: false,
    startedAt: null,
    isApiKeyMissing: false,
    isSyncing: false,
    submitGrid: vi.fn(),
    encodeGif: vi.fn(),
    encodeTunedGif: vi.fn(),
    downloadGif: vi.fn(),
    resetJob: vi.fn(),
    refreshFromServer: vi.fn(),
    updateJobStatus: vi.fn(),
  }),
}));

function emptyRegistry(): NovaModelRegistry {
  return { imageModels: [], textModels: [], defaults: { ...DEFAULT_DEFAULTS } };
}

function parentConfig(overrides: Partial<ParentNovaStudioConfig> = {}): ParentNovaStudioConfig {
  return {
    type: 'sub2api:nova-studio-config',
    sessionId: 'sess-gif-ui',
    revision: 1,
    baseUrl: PARENT_BASE,
    uiMode: 'embedded',
    hideVideo: true,
    hideByokSettings: true,
    ...overrides,
  };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderWorkspace(props: Partial<ComponentProps<typeof GifGenerationWorkspace>> = {}) {
  const result = render(
    <GifGenerationWorkspace
      hasApiKey={props.hasApiKey ?? true}
      onConfigureApiKey={props.onConfigureApiKey ?? vi.fn()}
      onError={props.onError ?? vi.fn()}
    />,
  );
  await flushEffects();
  return result;
}

describe('GifGenerationWorkspace 嵌入密钥误报', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEmbedRuntimeForTests();
    saveRegistry(emptyRegistry());
    syncDynamicModelExports();
  });

  afterEach(() => {
    resetEmbedRuntimeForTests();
    localStorage.clear();
  });

  it('先空 registry 渲染，再 apply 父站 gpt-image-2 后 options 非空', async () => {
    enableEmbeddedModeForTests({ configReceived: true });
    await renderWorkspace({ hasApiKey: true });

    expect(getGifCompatibleModels()).toEqual([]);
    expect(screen.getByText('父站还没有注入生图模型，请在「出图」栏选择密钥')).toBeInTheDocument();
    expect(screen.queryByText('生成网格图')).not.toBeInTheDocument();

    await act(async () => {
      ingestParentStudioMessage(parentConfig({
        image: {
          apiKey: 'sk-image',
          model: 'gpt-image-2',
          protocol: 'openai_images',
        },
      }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(getGifCompatibleModels().length).toBeGreaterThan(0);
    expect(screen.getByText('生成网格图')).toBeInTheDocument();
    expect(screen.queryByText('父站还没有注入生图模型，请在「出图」栏选择密钥')).not.toBeInTheDocument();
    expect(screen.queryByText('父站未提供密钥')).not.toBeInTheDocument();
    expect(screen.getAllByText(/OpenAI 动图按 1536×1024 出 4×3 网格/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/3264/)).not.toBeInTheDocument();
  });

  it('先空 registry 渲染，再 apply 父站 gpt-image-2.5 后 options 非空', async () => {
    enableEmbeddedModeForTests({ configReceived: true });
    await renderWorkspace({ hasApiKey: true });
    expect(getGifCompatibleModels()).toEqual([]);

    await act(async () => {
      ingestParentStudioMessage(parentConfig({
        image: {
          apiKey: 'sk-image',
          model: 'gpt-image-2.5',
          protocol: 'openai_images',
        },
      }));
      await Promise.resolve();
    });
    await flushEffects();

    expect(getGifCompatibleModels().length).toBeGreaterThan(0);
    expect(screen.getByText('生成网格图')).toBeInTheDocument();
    expect(screen.queryByText('父站未提供密钥')).not.toBeInTheDocument();
  });

  it('只注入 grok-imagine-image-quality 时能提交，且不出现父站未提供密钥', async () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-grok',
        model: 'grok-imagine-image-quality',
        protocol: 'grok_images',
      },
    }));

    const onConfigureApiKey = vi.fn();
    await renderWorkspace({ hasApiKey: true, onConfigureApiKey });

    expect(getGifCompatibleModels().length).toBeGreaterThan(0);
    expect(screen.getByText('生成网格图')).toBeInTheDocument();
    expect(screen.queryByText('当前出图模型不支持动图网格')).not.toBeInTheDocument();
    expect(screen.queryByText('父站还没有注入生图模型，请在「出图」栏选择密钥')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '打开设置' })).not.toBeInTheDocument();
    expect(screen.queryByText('父站未提供密钥')).not.toBeInTheDocument();
    expect(screen.queryByText('请先在设置中配置 Nova API 密钥')).not.toBeInTheDocument();
    expect(onConfigureApiKey).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/描述动画主题/), {
      target: { value: '一只虎斑猫缓慢眨眼' },
    });
    fireEvent.click(screen.getByRole('button', { name: /生成网格图/ }));
    expect(screen.queryByText('父站未提供密钥')).not.toBeInTheDocument();
  });

  it('嵌入且无生图密钥时，disabled 文案指向父站选密钥', async () => {
    enableEmbeddedModeForTests({ configReceived: true });
    await renderWorkspace({ hasApiKey: false });

    expect(screen.getByText('请先在父站选出图密钥，才能使用动图生成功能。')).toBeInTheDocument();
    expect(screen.queryByText('请先在设置中配置 Nova API 密钥，才能使用动图生成功能。')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '配置' }));
    expect(screen.getByText('父站未提供密钥')).toBeInTheDocument();
  });

  it('独立站空 registry 空态指向设置，且不写只有 gpt-image-2', async () => {
    await renderWorkspace({ hasApiKey: true });

    expect(screen.getByText('请在设置中配置生图模型后再使用动图生成。')).toBeInTheDocument();
    expect(screen.queryByText(/gpt-image-2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/只有/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开设置' })).toBeInTheDocument();
  });
});
