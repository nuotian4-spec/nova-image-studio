import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ingestParentStudioMessage } from '@/lib/embed/apply-parent';
import { enableEmbeddedModeForTests, resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import { withBasePath } from '@/lib/embed/public-path';
import {
  GIF_GRID_ASPECT_RATIO,
  GIF_GRID_CUSTOM_SIZE,
  GIF_GRID_OUTPUT_SIZE,
  getGifCompatibleModels,
  loadGifTemplate,
  resetGifTemplateCacheForTests,
  resolveGifGridSizeParams,
} from '@/lib/gif-job-store';
import { DEFAULT_DEFAULTS, saveRegistry, type NovaModelRegistry } from '@/lib/nova-models';
import { syncDynamicModelExports } from '@/lib/gemini-config';
import type { ParentNovaStudioConfig } from '@/lib/embed/protocol-map';

const PARENT_BASE = 'https://parent.example/';

function emptyRegistry(): NovaModelRegistry {
  return { imageModels: [], textModels: [], defaults: { ...DEFAULT_DEFAULTS } };
}

function parentConfig(overrides: Partial<ParentNovaStudioConfig> = {}): ParentNovaStudioConfig {
  return {
    type: 'sub2api:nova-studio-config',
    sessionId: 'sess-gif',
    revision: 1,
    baseUrl: PARENT_BASE,
    uiMode: 'embedded',
    hideVideo: true,
    hideByokSettings: true,
    ...overrides,
  };
}

function optionMentions(needle: string): boolean {
  const lowered = needle.toLowerCase();
  return getGifCompatibleModels().some((option) => (
    option.value.toLowerCase().includes(lowered)
    || option.label.toLowerCase().includes(lowered)
  ));
}

describe('getGifCompatibleModels', () => {
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

  it('空 registry 时列表为空', () => {
    expect(getGifCompatibleModels()).toEqual([]);
  });

  it('缺密钥的生图模型不会进入列表', () => {
    saveRegistry({
      imageModels: [{
        id: 'gpt-image-2',
        protocol: 'openai',
        name: 'GPT Image 2',
        modelId: 'gpt-image-2',
        apiKey: '',
        baseUrl: 'https://api.openai.com',
        builtinPreset: 'gpt-image-2',
        maxRefImages: 16,
        maxOutputSize: '4K',
        supportsAdvancedParams: true,
      }],
      textModels: [],
      defaults: { ...DEFAULT_DEFAULTS },
    });
    expect(getGifCompatibleModels()).toEqual([]);
  });

  it('只注入 grok-imagine-image-quality 时列表非空且含 grok', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-grok',
        model: 'grok-imagine-image-quality',
        protocol: 'grok_images',
      },
    }));
    const options = getGifCompatibleModels();
    expect(options.length).toBeGreaterThan(0);
    expect(optionMentions('grok')).toBe(true);
  });

  it('注入 gpt-image-2.5 + openai_images 后列表非空', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-image',
        model: 'gpt-image-2.5',
        protocol: 'openai_images',
      },
    }));
    const options = getGifCompatibleModels();
    expect(options.length).toBeGreaterThan(0);
    expect(optionMentions('gpt-image-2.5')).toBe(true);
  });

  it('注入 gpt-image-2 后列表非空', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-image',
        model: 'gpt-image-2',
        protocol: 'openai_images',
      },
    }));
    const options = getGifCompatibleModels();
    expect(options.length).toBeGreaterThan(0);
    expect(optionMentions('gpt-image-2')).toBe(true);
  });

  it('注入 gemini 后列表非空且含该模型', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-gemini',
        model: 'gemini-3-pro-image-preview',
        protocol: 'gemini_generate_content',
      },
    }));
    const options = getGifCompatibleModels();
    expect(options.length).toBeGreaterThan(0);
    expect(optionMentions('gemini-3-pro-image-preview')).toBe(true);
  });

  it('同时注入 grok / banana / gpt-image-2 时全部进入列表', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-image',
        model: 'gpt-image-2',
        protocol: 'openai_images',
        models: [
          { model: 'grok-imagine-image-quality', protocol: 'grok_images' },
          { model: 'gemini-3-pro-image-preview', protocol: 'gemini_generate_content' },
          { model: 'gpt-image-2', protocol: 'openai_images' },
        ],
      },
    }));
    const options = getGifCompatibleModels();
    expect(options.length).toBe(3);
    expect(optionMentions('gpt-image-2')).toBe(true);
    expect(optionMentions('grok')).toBe(true);
    expect(optionMentions('gemini')).toBe(true);
  });
});

describe('resolveGifGridSizeParams', () => {
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

  it('gpt-image-2 使用 OpenAI 合法横图 1536x1024，而不是 3264x2448', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-image',
        model: 'gpt-image-2',
        protocol: 'openai_images',
      },
    }));
    const modelId = getGifCompatibleModels()[0]?.value;
    expect(modelId).toBeTruthy();
    expect(GIF_GRID_CUSTOM_SIZE).toBe('1536x1024');
    expect(resolveGifGridSizeParams(modelId)).toEqual({
      outputSize: GIF_GRID_OUTPUT_SIZE,
      customSize: '1536x1024',
      aspectRatio: GIF_GRID_ASPECT_RATIO,
    });
    expect(resolveGifGridSizeParams(modelId).customSize).not.toBe('3264x2448');
  });

  it('gpt-image-2.5 同样走 1536x1024，而不是 3264x2448', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-image',
        model: 'gpt-image-2.5',
        protocol: 'openai_images',
      },
    }));
    const modelId = getGifCompatibleModels()[0]?.value;
    expect(resolveGifGridSizeParams(modelId).customSize).toBe('1536x1024');
    expect(resolveGifGridSizeParams(modelId).customSize).not.toBe('3264x2448');
    expect(resolveGifGridSizeParams(modelId).outputSize).toBe(GIF_GRID_OUTPUT_SIZE);
  });

  it('grok-imagine-image-quality 不传 customSize，outputSize 用 2K', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-grok',
        model: 'grok-imagine-image-quality',
        protocol: 'grok_images',
      },
    }));
    const modelId = getGifCompatibleModels()[0]?.value;
    expect(resolveGifGridSizeParams(modelId)).toEqual({
      outputSize: '2K',
      aspectRatio: GIF_GRID_ASPECT_RATIO,
    });
    expect(resolveGifGridSizeParams(modelId).customSize).toBeUndefined();
  });

  it('gemini 不传 customSize，outputSize 用声明的最大档', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-gemini',
        model: 'gemini-3-pro-image-preview',
        protocol: 'gemini_generate_content',
      },
    }));
    const modelId = getGifCompatibleModels()[0]?.value;
    expect(resolveGifGridSizeParams(modelId).customSize).toBeUndefined();
    expect(resolveGifGridSizeParams(modelId).outputSize).toBe('4K');
    expect(resolveGifGridSizeParams(modelId).aspectRatio).toBe(GIF_GRID_ASPECT_RATIO);
  });
});

const PNG_1X1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (ch) => ch.charCodeAt(0),
);

const PARENT_SPA_HTML = '<!DOCTYPE html><html><head><title>index</title></head><body>spa</body></html>';

function templateResponse(body: BodyInit, init?: ResponseInit): Response {
  return new Response(body, init);
}

function mockTemplateFetch(build: () => Response): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async () => build());
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('loadGifTemplate', () => {
  afterEach(() => {
    resetGifTemplateCacheForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fetch URL 必须是 /_nova/togif.png', async () => {
    const fetchMock = mockTemplateFetch(() => templateResponse(PNG_1X1, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));

    await loadGifTemplate();

    expect(withBasePath('/togif.png')).toBe('/_nova/togif.png');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/_nova/togif.png');
    expect(fetchMock.mock.calls[0]?.[1]).toEqual({ cache: 'force-cache' });
  });

  it('父站 HTML 200 必须抛错且不缓存', async () => {
    const fetchMock = mockTemplateFetch(() => templateResponse(PARENT_SPA_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    }));

    await expect(loadGifTemplate()).rejects.toThrow('禁止当 PNG 上传');
    await expect(loadGifTemplate()).rejects.toThrow('排版模板图内容不是图片');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/_nova/togif.png');
  });

  it('Content-Type 伪称 image/png 但正文是 HTML 时仍拒绝且不缓存', async () => {
    const fetchMock = mockTemplateFetch(() => templateResponse('  <html lang="zh">父站回退</html>', {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));

    await expect(loadGifTemplate()).rejects.toThrow('禁止当 PNG 上传');
    await expect(loadGifTemplate()).rejects.toThrow(/HTML/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('真 PNG 成功，并缓存避免重复 fetch', async () => {
    const fetchMock = mockTemplateFetch(() => templateResponse(PNG_1X1, {
      status: 200,
      headers: { 'Content-Type': 'image/png' },
    }));

    const first = await loadGifTemplate();
    const second = await loadGifTemplate();

    expect(first.mimeType).toBe('image/png');
    expect(first.data.length).toBeGreaterThan(0);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/_nova/togif.png');
  });

  it('非 2xx 仍抛无法加载排版模板图，且失败不缓存', async () => {
    const fetchMock = mockTemplateFetch(() => templateResponse('missing', { status: 404 }));

    await expect(loadGifTemplate()).rejects.toThrow('无法加载排版模板图 (404)');
    await expect(loadGifTemplate()).rejects.toThrow('无法加载排版模板图 (404)');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
