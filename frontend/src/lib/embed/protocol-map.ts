/**
 * Sub2API playground protocol → Nova 内部 protocol → 相对父站 baseUrl 的请求路径。
 * 纯函数，供 embedded 注入与自动化测试共用。
 */

export const NOVA_STUDIO_CONFIG_TYPE = 'sub2api:nova-studio-config' as const;
export const NOVA_STUDIO_REVOKE_TYPE = 'sub2api:nova-studio-revoke' as const;

export type NovaImageProtocol = 'openai' | 'grok' | 'google';
export type NovaTextProtocol =
  | 'openai-chat-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-gemini';

export type Sub2ApiImageProtocol = 'openai_images' | 'grok_images' | 'gemini_generate_content';
export type Sub2ApiTextProtocol =
  | 'openai_chat_completions'
  | 'openai_responses'
  | 'anthropic_messages'
  | 'google_gemini';

export const BLOCKED_UPSTREAM_HOSTS = [
  'api.openai.com',
  'api.x.ai',
  'generativelanguage.googleapis.com',
  'api.anthropic.com',
] as const;

const IMAGE_PROTOCOL_MAP: Record<Sub2ApiImageProtocol, NovaImageProtocol> = {
  openai_images: 'openai',
  grok_images: 'grok',
  gemini_generate_content: 'google',
};

const TEXT_PROTOCOL_MAP: Record<Sub2ApiTextProtocol, NovaTextProtocol> = {
  openai_chat_completions: 'openai-chat-completions',
  openai_responses: 'openai-responses',
  anthropic_messages: 'anthropic-messages',
  google_gemini: 'google-gemini',
};

export interface ParentModelEntry {
  model: string;
  protocol: string;
}

export interface ParentSideConfig {
  apiKey: string;
  keyId?: string;
  model: string;
  protocol: string;
  models?: ParentModelEntry[];
}

export interface ParentNovaStudioConfig {
  type: typeof NOVA_STUDIO_CONFIG_TYPE;
  sessionId: string;
  revision: number;
  baseUrl: string;
  uiMode: 'embedded';
  hideVideo: boolean;
  hideByokSettings: boolean;
  image?: ParentSideConfig;
  text?: ParentSideConfig;
  theme?: 'dark' | 'light' | 'system';
  /** 面板 JWT，只用于同源 /api/nova，不是生图/文本 API Key */
  sessionToken?: string;
}

export interface ImageRequestMapping {
  sub2apiProtocol: Sub2ApiImageProtocol;
  novaProtocol: NovaImageProtocol;
  generationsPath: string;
  editsPath: string;
}

export interface TextRequestMapping {
  sub2apiProtocol: Sub2ApiTextProtocol;
  novaProtocol: NovaTextProtocol;
  path: string;
}

export function isSub2ApiImageProtocol(value: unknown): value is Sub2ApiImageProtocol {
  return value === 'openai_images' || value === 'grok_images' || value === 'gemini_generate_content';
}

export function isSub2ApiTextProtocol(value: unknown): value is Sub2ApiTextProtocol {
  return value === 'openai_chat_completions'
    || value === 'openai_responses'
    || value === 'anthropic_messages'
    || value === 'google_gemini';
}

export function mapImageProtocol(protocol: string): NovaImageProtocol | null {
  if (isSub2ApiImageProtocol(protocol)) return IMAGE_PROTOCOL_MAP[protocol];
  if (protocol === 'openai' || protocol === 'grok' || protocol === 'google') return protocol;
  return null;
}

export function mapTextProtocol(protocol: string): NovaTextProtocol | null {
  if (isSub2ApiTextProtocol(protocol)) return TEXT_PROTOCOL_MAP[protocol];
  if (
    protocol === 'openai-chat-completions'
    || protocol === 'openai-responses'
    || protocol === 'anthropic-messages'
    || protocol === 'google-gemini'
  ) {
    return protocol;
  }
  return null;
}

export function joinBaseUrl(baseUrl: string, relativePath: string): string {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const path = String(relativePath || '').replace(/^\/+/, '');
  if (!base) return `/${path}`;
  return `${base}/${path}`;
}

export function isBlockedUpstreamHost(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    return (BLOCKED_UPSTREAM_HOSTS as readonly string[]).includes(host);
  } catch {
    return false;
  }
}

/** 嵌入模式强制走父站网关，拒绝直连官方上游。 */
export function resolveEmbedGatewayBaseUrl(parentBaseUrl: string): string {
  const trimmed = String(parentBaseUrl || '').trim();
  if (!trimmed || isBlockedUpstreamHost(trimmed)) return '';
  return trimmed.replace(/\/+$/, '') + '/';
}

export function imageRequestPaths(novaProtocol: NovaImageProtocol, modelId = ''): {
  generationsPath: string;
  editsPath: string;
} {
  if (novaProtocol === 'google') {
    const encoded = encodeURIComponent(modelId || 'gemini-3-pro-image-preview');
    const path = `v1beta/models/${encoded}:generateContent`;
    return { generationsPath: path, editsPath: path };
  }
  return {
    generationsPath: 'v1/images/generations',
    editsPath: 'v1/images/edits',
  };
}

export function textRequestPath(novaProtocol: NovaTextProtocol, modelId = ''): string {
  switch (novaProtocol) {
    case 'openai-chat-completions':
      return 'v1/chat/completions';
    case 'anthropic-messages':
      return 'v1/messages';
    case 'google-gemini':
      return `v1beta/models/${encodeURIComponent(modelId || 'gemini-2.5-flash')}:generateContent`;
    case 'openai-responses':
    default:
      return 'v1/responses';
  }
}

export function mapImageRequest(protocol: string, baseUrl: string, modelId = ''): ImageRequestMapping & {
  generationsUrl: string;
  editsUrl: string;
} | null {
  if (!isSub2ApiImageProtocol(protocol) && protocol !== 'openai' && protocol !== 'grok' && protocol !== 'google') {
    return null;
  }
  const sub2apiProtocol: Sub2ApiImageProtocol = isSub2ApiImageProtocol(protocol)
    ? protocol
    : protocol === 'grok'
      ? 'grok_images'
      : protocol === 'google'
        ? 'gemini_generate_content'
        : 'openai_images';
  const novaProtocol = mapImageProtocol(protocol);
  if (!novaProtocol) return null;
  const paths = imageRequestPaths(novaProtocol, modelId);
  const gateway = resolveEmbedGatewayBaseUrl(baseUrl) || baseUrl;
  return {
    sub2apiProtocol,
    novaProtocol,
    generationsPath: paths.generationsPath,
    editsPath: paths.editsPath,
    generationsUrl: joinBaseUrl(gateway, paths.generationsPath),
    editsUrl: joinBaseUrl(gateway, paths.editsPath),
  };
}

export function mapTextRequest(protocol: string, baseUrl: string, modelId = ''): TextRequestMapping & {
  url: string;
} | null {
  const novaProtocol = mapTextProtocol(protocol);
  if (!novaProtocol) return null;
  const sub2apiProtocol: Sub2ApiTextProtocol = isSub2ApiTextProtocol(protocol)
    ? protocol
    : novaProtocol === 'openai-chat-completions'
      ? 'openai_chat_completions'
      : novaProtocol === 'anthropic-messages'
        ? 'anthropic_messages'
        : novaProtocol === 'google-gemini'
          ? 'google_gemini'
          : 'openai_responses';
  const path = textRequestPath(novaProtocol, modelId);
  const gateway = resolveEmbedGatewayBaseUrl(baseUrl) || baseUrl;
  return {
    sub2apiProtocol,
    novaProtocol,
    path,
    url: joinBaseUrl(gateway, path),
  };
}

export function shouldHideVideoTab(input: { embedded?: boolean; hideVideo?: boolean }): boolean {
  if (input.hideVideo === true) return true;
  if (input.embedded) return true;
  return false;
}

export function shouldPersistApiKey(input: { embedded?: boolean }): boolean {
  return !input.embedded;
}

export function stripApiKeysFromRegistry<T extends {
  imageModels?: Array<{ apiKey?: string }>;
  textModels?: Array<{ apiKey?: string }>;
}>(registry: T): T {
  return {
    ...registry,
    imageModels: (registry.imageModels || []).map((model) => ({ ...model, apiKey: '' })),
    textModels: (registry.textModels || []).map((model) => ({ ...model, apiKey: '' })),
  };
}

export function persistedRegistryHasApiKey(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const parsed = JSON.parse(raw) as {
      imageModels?: Array<{ apiKey?: unknown }>;
      textModels?: Array<{ apiKey?: unknown }>;
    };
    const models = [...(parsed.imageModels || []), ...(parsed.textModels || [])];
    return models.some((model) => String(model?.apiKey || '').trim().length > 0);
  } catch {
    return false;
  }
}

export function listParentModelEntries(side: ParentSideConfig | undefined): ParentModelEntry[] {
  if (!side) return [];
  if (Array.isArray(side.models) && side.models.length > 0) {
    return side.models.filter((entry) => String(entry?.model || '').trim());
  }
  const model = String(side.model || '').trim();
  if (!model) return [];
  return [{ model, protocol: side.protocol }];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 兼容两种信封：扁平 `{ type, sessionId, image, ... }` 与 playground
 * `{ type, payload: { sessionId, image, ... } }`。外层 type 优先。
 */
export function flattenParentStudioEnvelope(data: unknown): Record<string, unknown> | null {
  if (!isPlainObject(data)) return null;
  const payload = data.payload;
  if (!isPlainObject(payload)) {
    return { ...data };
  }
  const merged: Record<string, unknown> = { ...payload, ...data };
  delete merged.payload;
  if (data.type != null && data.type !== '') {
    merged.type = data.type;
  }
  return merged;
}

export function parseParentStudioMessage(data: unknown): ParentNovaStudioConfig | { type: typeof NOVA_STUDIO_REVOKE_TYPE } | null {
  const record = flattenParentStudioEnvelope(data);
  if (!record) return null;
  if (record.type === NOVA_STUDIO_REVOKE_TYPE) {
    return { type: NOVA_STUDIO_REVOKE_TYPE };
  }
  if (record.type !== NOVA_STUDIO_CONFIG_TYPE) return null;

  const image = parseSideConfig(record.image);
  const text = parseSideConfig(record.text);
  const theme = record.theme === 'dark' || record.theme === 'light' || record.theme === 'system'
    ? record.theme
    : undefined;
  const sessionToken = String(record.sessionToken || '').trim();

  return {
    type: NOVA_STUDIO_CONFIG_TYPE,
    sessionId: String(record.sessionId || ''),
    revision: typeof record.revision === 'number' ? record.revision : Number(record.revision) || 0,
    baseUrl: String(record.baseUrl || ''),
    uiMode: 'embedded',
    hideVideo: record.hideVideo !== false,
    hideByokSettings: record.hideByokSettings !== false,
    ...(image ? { image } : {}),
    ...(text ? { text } : {}),
    ...(theme ? { theme } : {}),
    ...(sessionToken ? { sessionToken } : {}),
  };
}

function parseSideConfig(raw: unknown): ParentSideConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const record = raw as Record<string, unknown>;
  const apiKey = String(record.apiKey || '').trim();
  const model = String(record.model || '').trim();
  const protocol = String(record.protocol || '').trim();
  const keyId = record.keyId != null ? String(record.keyId) : undefined;
  const models = Array.isArray(record.models)
    ? record.models
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const entry = item as Record<string, unknown>;
        const nextModel = String(entry.model || '').trim();
        if (!nextModel) return null;
        return { model: nextModel, protocol: String(entry.protocol || protocol) };
      })
      .filter((item): item is ParentModelEntry => Boolean(item))
    : undefined;
  if (!apiKey && !model && !protocol && (!models || models.length === 0)) return undefined;
  return {
    apiKey,
    model,
    protocol,
    ...(keyId ? { keyId } : {}),
    ...(models && models.length > 0 ? { models } : {}),
  };
}
