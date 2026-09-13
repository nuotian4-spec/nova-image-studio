import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { enableEmbeddedModeForTests, resetEmbedRuntimeForTests } from '@/lib/embed/mode';
import { DEFAULT_DEFAULTS, saveRegistry } from '@/lib/nova-models';
import { EMBED_SLICE_IMAGE_MISSING_HINT } from '@/lib/slice-model-config';
import { BackgroundConfirmDialog } from '../BackgroundConfirmDialog';

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

describe('BackgroundConfirmDialog 嵌入 grok-only', () => {
  beforeEach(() => {
    localStorage.clear();
    resetEmbedRuntimeForTests();
    enableEmbeddedModeForTests();
    saveRegistry({
      imageModels: [GROK_IMAGE],
      textModels: [],
      defaults: { ...DEFAULT_DEFAULTS, textToImage: GROK_IMAGE.id, imageToImage: GROK_IMAGE.id },
    });
  });

  afterEach(() => {
    cleanup();
    resetEmbedRuntimeForTests();
    localStorage.clear();
  });

  it('grok-only 不因协议挡门，也不打开 BYOK', () => {
    const onConfigureApiKey = vi.fn();
    const showToast = vi.fn();
    render(
      <BackgroundConfirmDialog
        open
        onOpenChange={() => undefined}
        sourceImageUrl={null}
        naturalSize={{ width: 100, height: 100 }}
        candidates={[{
          id: 'background_01',
          name: 'hero',
          bbox: { x: 0, y: 0, width: 80, height: 80 },
          confidence: 1,
          reason: 'covered',
          bakedVisuals: [],
          overlays: [{
            id: 'overlay_01',
            name: 'chip',
            kind: 'code-overlay',
            bbox: { x: 4, y: 4, width: 16, height: 16 },
            confidence: 1,
            reason: 'overlay',
          }],
        }]}
        model=""
        getSourceImg={() => null}
        onConfigureApiKey={onConfigureApiKey}
        showToast={showToast}
        onGenerated={() => undefined}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /生成完整背景/ }));
    expect(showToast).not.toHaveBeenCalledWith(EMBED_SLICE_IMAGE_MISSING_HINT, 'error');
    expect(showToast.mock.calls.some((call) => /OpenAI|gpt-image-2|Grok 不支持/.test(String(call[0])))).toBe(false);
    expect(onConfigureApiKey).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith('源图尚未加载完成，请稍后重试', 'error');
  });
});
