import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enableEmbeddedModeForTests, resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import { DEFAULT_DEFAULTS, saveRegistry } from '@/lib/nova-models';
import { EMBED_SLICE_IMAGE_MISSING_HINT } from '@/lib/slice-model-config';
import { SliceImageModelPicker } from '../SliceImageModelPicker';

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

describe('SliceImageModelPicker 嵌入 grok-only', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEmbedRuntimeForTests();
  });

  afterEach(() => {
    cleanup();
    resetEmbedRuntimeForTests();
    localStorage.clear();
  });

  it('grok-only 显示 Grok 名称，不显示 OpenAI 改选 hint', () => {
    enableEmbeddedModeForTests();
    saveRegistry({
      imageModels: [GROK_IMAGE],
      textModels: [],
      defaults: { ...DEFAULT_DEFAULTS, textToImage: GROK_IMAGE.id, imageToImage: GROK_IMAGE.id },
    });
    const onSelect = vi.fn();
    render(<SliceImageModelPicker value="" onSelect={onSelect} />);
    expect(screen.getByText('Grok Imagine')).toBeInTheDocument();
    expect(screen.getByText('grok-imagine-image')).toBeInTheDocument();
    expect(screen.queryByText(EMBED_SLICE_IMAGE_MISSING_HINT)).not.toBeInTheDocument();
    expect(screen.queryByText(/设置 → 模型/)).not.toBeInTheDocument();
    expect(screen.queryByText(/gpt-image-2/)).not.toBeInTheDocument();
    expect(screen.queryByText(/OpenAI/)).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('registry 后续注入 grok 模型时选择器更新，不把列表算死', async () => {
    enableEmbeddedModeForTests();
    saveRegistry({
      imageModels: [],
      textModels: [],
      defaults: { ...DEFAULT_DEFAULTS },
    });
    render(<SliceImageModelPicker value="" onSelect={() => undefined} />);
    expect(screen.getByText(EMBED_SLICE_IMAGE_MISSING_HINT)).toBeInTheDocument();

    act(() => {
      saveRegistry({
        imageModels: [GROK_IMAGE],
        textModels: [],
        defaults: {
          ...DEFAULT_DEFAULTS,
          textToImage: GROK_IMAGE.id,
          imageToImage: GROK_IMAGE.id,
          sliceImageEdit: GROK_IMAGE.id,
        },
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Grok Imagine')).toBeInTheDocument();
    });
    expect(screen.queryByText(EMBED_SLICE_IMAGE_MISSING_HINT)).not.toBeInTheDocument();
  });
});
