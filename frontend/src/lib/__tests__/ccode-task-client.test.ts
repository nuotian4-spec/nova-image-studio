import { beforeEach, describe, expect, it } from 'vitest';
import { resolveImageTaskProvider } from '@/lib/ccode-task-client';
import { resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import { saveRegistry } from '@/lib/nova-models';

const EMBED_IMAGE = {
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

describe('resolveImageTaskProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEmbedRuntimeForTests();
    saveRegistry({
      imageModels: [EMBED_IMAGE],
      textModels: [],
      defaults: {
        textToImage: EMBED_IMAGE.id,
        imageToImage: EMBED_IMAGE.id,
        reversePrompt: '',
        agent: '',
        promptOptimize: '',
        imageDescribe: '',
        sliceDecomposition: '',
        sliceReconstruct: '',
        sliceImageEdit: EMBED_IMAGE.id,
      },
    });
  });

  it('按 id 或 modelId 都能命中 embed-img:gpt-image-2', () => {
    const byId = resolveImageTaskProvider('embed-img:gpt-image-2');
    const byModelId = resolveImageTaskProvider('gpt-image-2');

    expect(byId).toEqual(byModelId);
    expect(byId.modelId).toBe('gpt-image-2');
    expect(byId.apiKey).toBe('sk-embed-gpt-image-2');
    expect(byId.protocol).toBe('openai');
  });

  it('找不到完整模型时 throw', () => {
    expect(() => resolveImageTaskProvider('gemini-3-pro-image-preview')).toThrow(
      '未找到图片模型配置: gemini-3-pro-image-preview',
    );
  });
});
