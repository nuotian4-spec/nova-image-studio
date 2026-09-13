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

/** 发给 Host GrokImages 的 model 必须是官方 ID，不能是 plaza 显示名。 */
export function canonicalizeGrokUpstreamModelId(modelId: string): string {
  const trimmed = modelId.trim();
  // 与 Host canonicalizeGrokImageModel 一样折叠空白/连字符，避免显示名带多空格时漏映射。
  const compact = trimmed
    .toLowerCase()
    .replace(/[_]+/g, '-')
    .replace(/[\s-]+/g, '-');

  if (
    compact === 'grok-imagine'
    || compact === 'grok-imagine-1'
    || compact === 'grok-imagine-edit'
  ) {
    return 'grok-imagine-image-quality';
  }
  if (compact.startsWith('grok-imagine-image')) {
    return compact;
  }
  return trimmed;
}

function pickImagePreset(protocol: ProviderProtocol, modelId: string): BuiltinImagePresetId {
  if (modelId in BUILTIN_IMAGE_PRESETS) return modelId as BuiltinImagePresetId;
  const lowered = modelId.toLowerCase();
  if (protocol === 'google') {
    if (lowered.includes('flash-lite')) return 'gemini-3.1-flash-lite-image';
    if (lowered.includes('3.1-flash')) return 'gemini-3.1-flash-image-preview';
    if (lowered.includes('2.5-flash')) return 'gemini-2.5-flash-image';
    return 'gemini-3-pro-image-preview';
  }
  if (protocol === 'grok') {
    if (lowered.includes('edit')) return 'grok-imagine-image-edit';
    if (lowered.includes('quality')) return 'grok-imagine-image-quality';
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
    const upstreamModelId = protocol === 'grok'
      ? canonicalizeGrokUpstreamModelId(entry.model)
      : entry.model;
    const presetId = pickImagePreset(protocol, entry.model);
    const preset = BUILTIN_IMAGE_PRESETS[presetId];
    const model: ImageModelConfig = {
      id: `embed-img:${entry.model}`,
      protocol,
      name: entry.model,
      modelId: upstreamModelId,
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

function findParentImageModel(
  models: ImageModelConfig[],
  parentModel: string | undefined,
): ImageModelConfig | undefined {
  if (!parentModel) return undefined;
  const trimmed = parentModel.trim();
  const canonical = canonicalizeGrokUpstreamModelId(trimmed);
  return models.find((model) => model.modelId === trimmed)
    || models.find((model) => model.modelId === canonical)
    || models.find((model) => model.name === trimmed)
    || models.find((model) => model.id === `embed-img:${trimmed}`);
}

export function buildRegistryFromParentConfig(config: ParentNovaStudioConfig): NovaModelRegistry {
  const imageModels = buildImageModels(config);
  const textModels = buildTextModels(config);
  const preferredImageId = findParentImageModel(imageModels, config.image?.model)?.id
    || imageModels[0]?.id
    || '';
  const preferredTextId = config.text?.model
    ? textModels.find((model) => model.modelId === config.text?.model)?.id || textModels[0]?.id || ''
    : textModels[0]?.id || '';

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
      sliceImageEdit: preferredImageId,
    },
  };
}
