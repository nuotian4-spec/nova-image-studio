import { beforeEach, describe, expect, it } from 'vitest';
import { resolveImageTaskProvider } from '@/lib/ccode-task-client';
import { resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import {
  pickAgentImageModel,
  resolveAgentModel,
  type AgentModelCatalogEntry,
} from '@/lib/model-capabilities';
import { saveRegistry } from '@/lib/nova-models';

const EMBED_GPT_IMAGE_2: AgentModelCatalogEntry = {
  id: 'embed-img:gpt-image-2',
  name: 'gpt-image-2',
  maxOutputSize: '4K',
};

const EMBED_GPT_IMAGE_2_5: AgentModelCatalogEntry = {
  id: 'embed-img:gpt-image-2.5',
  name: 'gpt-image-2.5',
  maxOutputSize: '4K',
};

const EMBED_IMAGE_REGISTRY = {
  id: 'embed-img:gpt-image-2',
  protocol: 'openai' as const,
  name: 'gpt-image-2',
  modelId: 'gpt-image-2',
  apiKey: 'sk-embed-gpt-image-2',
  baseUrl: 'https://parent.example',
  builtinPreset: 'gpt-image-2' as const,
  maxRefImages: 16,
  maxOutputSize: '4K' as const,
  supportsAdvancedParams: true,
};

describe('pickAgentImageModel', () => {
  it('registry 只有 embed-img:gpt-image-2 时，把 gemini 内置校正到 catalog 默认', () => {
    expect(pickAgentImageModel(
      'gemini-3-pro-image-preview',
      [EMBED_GPT_IMAGE_2],
      'embed-img:gpt-image-2',
    )).toBe('embed-img:gpt-image-2');
  });

  it('current 已在 catalog 时保留用户选择，不强制跳回 default', () => {
    expect(pickAgentImageModel(
      'embed-img:gpt-image-2',
      [EMBED_GPT_IMAGE_2, EMBED_GPT_IMAGE_2_5],
      'embed-img:gpt-image-2.5',
    )).toBe('embed-img:gpt-image-2');
  });

  it('default 不在 catalog 时用 catalog[0]', () => {
    expect(pickAgentImageModel(
      '',
      [EMBED_GPT_IMAGE_2, EMBED_GPT_IMAGE_2_5],
      'embed-img:missing',
    )).toBe('embed-img:gpt-image-2');
  });

  it('catalog 为空时无法校正，保留 current 供后续 registry-updated 再跑', () => {
    expect(pickAgentImageModel('gemini-3-pro-image-preview', [], 'embed-img:gpt-image-2'))
      .toBe('gemini-3-pro-image-preview');
  });
});

describe('resolveAgentModel', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEmbedRuntimeForTests();
    saveRegistry({
      imageModels: [EMBED_IMAGE_REGISTRY],
      textModels: [],
      defaults: {
        textToImage: EMBED_IMAGE_REGISTRY.id,
        imageToImage: EMBED_IMAGE_REGISTRY.id,
        reversePrompt: '',
        agent: '',
        promptOptimize: '',
        imageDescribe: '',
        sliceDecomposition: '',
        sliceReconstruct: '',
        sliceImageEdit: EMBED_IMAGE_REGISTRY.id,
      },
    });
  });

  it('requestedModelId 是 catalog 内 id 时尊重用户指定', () => {
    const catalog = [EMBED_GPT_IMAGE_2, EMBED_GPT_IMAGE_2_5];
    expect(resolveAgentModel(
      'gemini-3-pro-image-preview',
      'embed-img:gpt-image-2.5',
      undefined,
      catalog,
      'embed-img:gpt-image-2',
    )).toBe('embed-img:gpt-image-2.5');
  });

  it('requestedModelId 是 gemini 且 catalog 无 gemini 时回落到 catalog 默认，不 throw', () => {
    const resolved = resolveAgentModel(
      'gemini-3-pro-image-preview',
      'gemini-3-pro-image-preview',
      undefined,
      [EMBED_GPT_IMAGE_2],
      'embed-img:gpt-image-2',
    );
    expect(resolved).toBe('embed-img:gpt-image-2');
    expect(() => resolveImageTaskProvider(resolved)).not.toThrow();
    expect(resolveImageTaskProvider(resolved).modelId).toBe('gpt-image-2');
  });

  it('requested_model_id 为空且 current 是 gemini 时，校正到 catalog 而不是原样返回', () => {
    expect(resolveAgentModel(
      'gemini-3-pro-image-preview',
      undefined,
      undefined,
      [EMBED_GPT_IMAGE_2],
      'embed-img:gpt-image-2',
    )).toBe('embed-img:gpt-image-2');
  });
});
