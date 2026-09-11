import {
  BUILTIN_IMAGE_PRESETS,
  getDefaultTextModelTemplate,
  type BuiltinImagePresetId,
  type ImageModelConfig,
  type NovaModelRegistry,
  type ProviderProtocol,
  type TextModelConfig,
} from '@/lib/nova-models';
import {
  listParentModelEntries,
  mapImageProtocol,
  mapTextProtocol,
  resolveEmbedGatewayBaseUrl,
  type ParentNovaStudioConfig,
} from '@/lib/embed/protocol-map';

function pickImagePreset(protocol: ProviderProtocol, modelId: string): BuiltinImagePresetId {
  if (modelId in BUILTIN_IMAGE_PRESETS) return modelId as BuiltinImagePresetId;
  if (protocol === 'google') {
    if (modelId.includes('flash-lite')) return 'gemini-3.1-flash-lite-image';
    if (modelId.includes('3.1-flash')) return 'gemini-3.1-flash-image-preview';
    if (modelId.includes('2.5-flash')) return 'gemini-2.5-flash-image';
    return 'gemini-3-pro-image-preview';
  }
  if (protocol === 'grok') {
    if (modelId.includes('edit')) return 'grok-imagine-image-edit';
    if (modelId.includes('quality')) return 'grok-imagine-image-quality';
    return 'grok-imagine-image';
  }
  return 'gpt-image-2';
}

function buildImageModels(config: ParentNovaStudioConfig): ImageModelConfig[] {
  const gateway = resolveEmbedGatewayBaseUrl(config.baseUrl);
  if (!gateway || !config.image?.apiKey) return [];

  return listParentModelEntries(config.image).flatMap((entry) => {
    const protocol = mapImageProtocol(entry.protocol);
    if (!protocol) return [];
    const presetId = pickImagePreset(protocol, entry.model);
    const preset = BUILTIN_IMAGE_PRESETS[presetId];
    const model: ImageModelConfig = {
      id: `embed-img:${entry.model}`,
      protocol,
      name: entry.model,
      modelId: entry.model,
      apiKey: config.image!.apiKey,
      baseUrl: gateway,
      builtinPreset: presetId,
      maxRefImages: preset.maxRefImages,
      maxOutputSize: preset.maxOutputSize,
      supportsAdvancedParams: protocol === 'openai' ? preset.supportsAdvancedParams : false,
    };
    return [model];
  });
}

function buildTextModels(config: ParentNovaStudioConfig): TextModelConfig[] {
  const gateway = resolveEmbedGatewayBaseUrl(config.baseUrl);
  if (!gateway || !config.text?.apiKey) return [];

  return listParentModelEntries(config.text).flatMap((entry) => {
    const protocol = mapTextProtocol(entry.protocol);
    if (!protocol) return [];
    const template = getDefaultTextModelTemplate(protocol);
    const model: TextModelConfig = {
      id: `embed-txt:${entry.model}`,
      protocol,
      name: entry.model,
      modelId: entry.model,
      apiKey: config.text!.apiKey,
      baseUrl: gateway,
      note: `当前模型来自父站 · ${template.note || protocol}`,
    };
    return [model];
  });
}

export function buildRegistryFromParentConfig(config: ParentNovaStudioConfig): NovaModelRegistry {
  const imageModels = buildImageModels(config);
  const textModels = buildTextModels(config);
  const preferredImageId = config.image?.model
    ? imageModels.find((model) => model.modelId === config.image?.model)?.id || imageModels[0]?.id || ''
    : imageModels[0]?.id || '';
  const preferredTextId = config.text?.model
    ? textModels.find((model) => model.modelId === config.text?.model)?.id || textModels[0]?.id || ''
    : textModels[0]?.id || '';
  const sliceImageId = imageModels.find((model) => model.protocol === 'openai')?.id || '';

  return {
    imageModels,
    textModels,
    defaults: {
      textToImage: preferredImageId,
      imageToImage: preferredImageId,
      reversePrompt: preferredTextId,
      agent: preferredTextId,
      promptOptimize: preferredTextId,
      imageDescribe: preferredTextId,
      sliceDecomposition: preferredTextId,
      sliceReconstruct: preferredTextId,
      sliceImageEdit: sliceImageId,
    },
  };
}
