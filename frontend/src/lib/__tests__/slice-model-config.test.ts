import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enableEmbeddedModeForTests, resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import { DEFAULT_DEFAULTS, saveRegistry, type NovaModelRegistry } from '@/lib/nova-models';
import {
  EMBED_SLICE_IMAGE_MISSING_HINT,
  describeSliceImageModelMissing,
  describeSliceTextModelMissing,
  hasSliceImageModel,
  listSliceImageModels,
  reportSliceCapabilityGap,
  requireSliceImageModel,
  requireSliceTextModel,
} from '@/lib/slice-model-config';

const GROK_IMAGE = {
  id: 'grok-imagine-image',
  protocol: 'grok' as const,
  name: 'Grok Imagine',
  modelId: 'grok-imagine-image',
  apiKey: 'sk-grok-embed',
  baseUrl: 'https://parent.example',
  builtinPreset: 'grok-imagine-image' as const,
  maxRefImages: 4,
  maxOutputSize: '2K' as const,
  supportsAdvancedParams: false,
};

const GPT_IMAGE = {
  id: 'gpt-image-2',
  protocol: 'openai' as const,
  name: 'GPT Image 2',
  modelId: 'gpt-image-2',
  apiKey: 'sk-openai-embed',
  baseUrl: 'https://parent.example',
  builtinPreset: 'gpt-image-2' as const,
  maxRefImages: 16,
  maxOutputSize: '4K' as const,
  supportsAdvancedParams: true,
};

const TEXT_MODEL = {
  id: 'text-1',
  protocol: 'openai-chat-completions' as const,
  name: '对话模型',
  modelId: 'gpt-4o-mini',
  apiKey: 'sk-text-embed',
  baseUrl: 'https://parent.example',
};

function grokOnlyRegistry(): NovaModelRegistry {
  return {
    imageModels: [GROK_IMAGE],
    textModels: [TEXT_MODEL],
    defaults: {
      ...DEFAULT_DEFAULTS,
      textToImage: GROK_IMAGE.id,
      imageToImage: GROK_IMAGE.id,
      agent: TEXT_MODEL.id,
      sliceDecomposition: TEXT_MODEL.id,
      sliceReconstruct: TEXT_MODEL.id,
    },
  };
}

describe('slice-model-config 嵌入诚实文案', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEmbedRuntimeForTests();
  });

  afterEach(() => {
    resetEmbedRuntimeForTests();
    localStorage.clear();
  });

  it('grok-only registry 能 slice，list 含 grok', () => {
    enableEmbeddedModeForTests();
    saveRegistry(grokOnlyRegistry());
    expect(hasSliceImageModel()).toBe(true);
    expect(listSliceImageModels().map((model) => model.id)).toEqual([GROK_IMAGE.id]);
    expect(listSliceImageModels()[0]?.displayName).toBe('Grok Imagine');
    expect(() => requireSliceImageModel()).not.toThrow();
    expect(requireSliceImageModel().modelId).toBe(GROK_IMAGE.modelId);
  });

  it('嵌入一个生图模型都没有时，缺图模型文案指向父站出图栏，而不是设置', () => {
    enableEmbeddedModeForTests();
    saveRegistry({
      imageModels: [],
      textModels: [TEXT_MODEL],
      defaults: { ...DEFAULT_DEFAULTS, agent: TEXT_MODEL.id },
    });
    const message = describeSliceImageModelMissing();
    expect(message).toBe(EMBED_SLICE_IMAGE_MISSING_HINT);
    expect(message).toContain('父站「出图」');
    expect(message).not.toContain('gpt-image-2');
    expect(message).not.toMatch(/OpenAI|Grok 不支持|蒙版/);
    expect(message).not.toContain('设置 → 模型');
    expect(() => requireSliceImageModel()).toThrow(/父站「出图」/);
  });

  it('嵌入缺文本模型时指引去父站 Agent / 对话，不提设置', () => {
    enableEmbeddedModeForTests();
    saveRegistry({
      imageModels: [GROK_IMAGE],
      textModels: [],
      defaults: { ...DEFAULT_DEFAULTS, textToImage: GROK_IMAGE.id, imageToImage: GROK_IMAGE.id },
    });
    const message = describeSliceTextModelMissing('sliceDecomposition');
    expect(message).toContain('Agent / 对话');
    expect(message).not.toContain('设置 → 模型');
    expect(() => requireSliceTextModel('sliceDecomposition')).toThrow(/Agent \/ 对话/);
  });

  it('嵌入缺全部生图模型时 toast 父站出图文案，且不调用 onConfigureApiKey', () => {
    enableEmbeddedModeForTests();
    saveRegistry({
      imageModels: [],
      textModels: [TEXT_MODEL],
      defaults: { ...DEFAULT_DEFAULTS },
    });
    const showToast = vi.fn();
    const onConfigureApiKey = vi.fn();
    reportSliceCapabilityGap({
      kind: 'image',
      showToast,
      onConfigureApiKey,
    });
    expect(showToast).toHaveBeenCalledWith(EMBED_SLICE_IMAGE_MISSING_HINT, 'error');
    expect(onConfigureApiKey).not.toHaveBeenCalled();
  });

  it('嵌入缺文本时 toast 父站 Agent 文案，且不调用 onConfigureApiKey', () => {
    enableEmbeddedModeForTests();
    saveRegistry({
      imageModels: [GPT_IMAGE],
      textModels: [],
      defaults: { ...DEFAULT_DEFAULTS, textToImage: GPT_IMAGE.id, imageToImage: GPT_IMAGE.id, sliceImageEdit: GPT_IMAGE.id },
    });
    const showToast = vi.fn();
    const onConfigureApiKey = vi.fn();
    reportSliceCapabilityGap({
      kind: 'sliceReconstruct',
      showToast,
      onConfigureApiKey,
    });
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Agent / 对话'), 'error');
    expect(onConfigureApiKey).not.toHaveBeenCalled();
  });

  it('独立站缺生图模型仍打开设置，文案保留设置路径', () => {
    saveRegistry({
      imageModels: [],
      textModels: [],
      defaults: { ...DEFAULT_DEFAULTS },
    });
    const showToast = vi.fn();
    const onConfigureApiKey = vi.fn();
    reportSliceCapabilityGap({
      kind: 'image',
      showToast,
      onConfigureApiKey,
    });
    expect(showToast).toHaveBeenCalled();
    expect(String(showToast.mock.calls[0][0])).toContain('设置');
    expect(String(showToast.mock.calls[0][0])).not.toMatch(/Gemini 与 Grok 不支持/);
    expect(onConfigureApiKey).toHaveBeenCalledTimes(1);
    expect(() => requireSliceTextModel('sliceDecomposition')).toThrow(/设置 → 模型/);
  });

  it('缺 apiKey 的生图模型不算 slice capable', () => {
    saveRegistry({
      imageModels: [{ ...GROK_IMAGE, apiKey: '' }],
      textModels: [TEXT_MODEL],
      defaults: { ...DEFAULT_DEFAULTS, agent: TEXT_MODEL.id },
    });
    expect(hasSliceImageModel()).toBe(false);
    expect(listSliceImageModels()).toEqual([]);
  });
});
