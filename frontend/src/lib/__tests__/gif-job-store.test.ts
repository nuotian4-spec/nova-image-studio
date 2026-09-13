import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ingestParentStudioMessage } from '@/lib/embed/apply-parent';
import { enableEmbeddedModeForTests, resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import {
  GIF_GRID_ASPECT_RATIO,
  GIF_GRID_CUSTOM_SIZE,
  GIF_GRID_OUTPUT_SIZE,
  getGifCompatibleModels,
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

  it('支持自定义尺寸的 gpt-image-2 保持现网网格', () => {
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
    expect(resolveGifGridSizeParams(modelId)).toEqual({
      outputSize: GIF_GRID_OUTPUT_SIZE,
      customSize: GIF_GRID_CUSTOM_SIZE,
      aspectRatio: GIF_GRID_ASPECT_RATIO,
    });
  });

  it('gpt-image-2.5 走自定义尺寸网格', () => {
    enableEmbeddedModeForTests({ configReceived: true });
    ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-image',
        model: 'gpt-image-2.5',
        protocol: 'openai_images',
      },
    }));
    const modelId = getGifCompatibleModels()[0]?.value;
    expect(resolveGifGridSizeParams(modelId).customSize).toBe(GIF_GRID_CUSTOM_SIZE);
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
