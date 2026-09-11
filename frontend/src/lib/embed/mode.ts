import type { NovaModelRegistry } from '@/lib/nova-models';
import {
  NOVA_STUDIO_CONFIG_TYPE,
  NOVA_STUDIO_REVOKE_TYPE,
  parseParentStudioMessage,
  shouldHideVideoTab,
  type ParentNovaStudioConfig,
  type ParentSideConfig,
} from '@/lib/embed/protocol-map';

export interface EmbedRuntimeState {
  enabled: boolean;
  configReceived: boolean;
  revoked: boolean;
  sessionId: string;
  revision: number;
  baseUrl: string;
  hideVideo: boolean;
  hideByokSettings: boolean;
  theme?: 'dark' | 'light' | 'system';
  image?: ParentSideConfig;
  text?: ParentSideConfig;
  sessionToken: string;
  memoryRegistry: NovaModelRegistry | null;
}

const EMPTY_STATE: EmbedRuntimeState = {
  enabled: false,
  configReceived: false,
  revoked: false,
  sessionId: '',
  revision: 0,
  baseUrl: '',
  hideVideo: false,
  hideByokSettings: false,
  sessionToken: '',
  memoryRegistry: null,
};

let state: EmbedRuntimeState = { ...EMPTY_STATE };
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // ignore subscriber errors
    }
  }
}

export function subscribeEmbedRuntime(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEmbedRuntimeState(): EmbedRuntimeState {
  return state;
}

export function readEmbeddedQuery(search?: string): boolean {
  const value = search ?? (typeof window !== 'undefined' ? window.location.search : '');
  try {
    return new URLSearchParams(value).get('embedded') === '1';
  } catch {
    return false;
  }
}

export function isEmbeddedMode(): boolean {
  return state.enabled || readEmbeddedQuery();
}

export function shouldHideVideo(): boolean {
  if (shouldHideVideoTab({ embedded: isEmbeddedMode(), hideVideo: state.hideVideo })) return true;
  return false;
}

export function shouldHideByokSettings(): boolean {
  return isEmbeddedMode();
}

export function getSessionToken(): string {
  return state.sessionToken || '';
}

export function getEmbeddedMemoryRegistry(): NovaModelRegistry | null {
  return state.memoryRegistry;
}

export function setEmbeddedMemoryRegistry(registry: NovaModelRegistry | null): void {
  state = { ...state, memoryRegistry: registry };
  emit();
}

export function markEmbeddedFromQuery(): void {
  if (!readEmbeddedQuery()) return;
  if (state.enabled && state.hideVideo && state.hideByokSettings) return;
  state = {
    ...state,
    enabled: true,
    hideVideo: true,
    hideByokSettings: true,
  };
  emit();
}

export function applyParentStudioMessage(data: unknown): 'config' | 'revoke' | 'ignored' {
  const parsed = parseParentStudioMessage(data);
  if (!parsed) return 'ignored';

  if (parsed.type === NOVA_STUDIO_REVOKE_TYPE) {
    state = {
      ...state,
      enabled: true,
      configReceived: true,
      revoked: true,
      hideVideo: true,
      hideByokSettings: true,
      image: undefined,
      text: undefined,
      sessionToken: '',
      memoryRegistry: {
        imageModels: [],
        textModels: [],
        defaults: {
          textToImage: '',
          imageToImage: '',
          reversePrompt: '',
          agent: '',
          promptOptimize: '',
          imageDescribe: '',
          sliceDecomposition: '',
          sliceReconstruct: '',
          sliceImageEdit: '',
        },
      },
    };
    emit();
    return 'revoke';
  }

  if (parsed.type !== NOVA_STUDIO_CONFIG_TYPE) return 'ignored';
  return applyParentConfig(parsed);
}

export function applyParentConfig(config: ParentNovaStudioConfig): 'config' | 'ignored' {
  if (
    state.configReceived
    && state.sessionId
    && config.sessionId === state.sessionId
    && typeof config.revision === 'number'
    && config.revision < state.revision
  ) {
    return 'ignored';
  }

  state = {
    enabled: true,
    configReceived: true,
    revoked: false,
    sessionId: config.sessionId,
    revision: config.revision,
    baseUrl: config.baseUrl,
    hideVideo: config.hideVideo !== false,
    hideByokSettings: config.hideByokSettings !== false,
    theme: config.theme,
    image: config.image,
    text: config.text,
    sessionToken: config.sessionToken || '',
    memoryRegistry: state.memoryRegistry,
  };
  emit();
  return 'config';
}

export function resetEmbedRuntimeForTests(): void {
  state = { ...EMPTY_STATE };
  emit();
}

export function enableEmbeddedModeForTests(patch: Partial<EmbedRuntimeState> = {}): void {
  state = {
    ...state,
    enabled: true,
    hideVideo: true,
    hideByokSettings: true,
    ...patch,
  };
  emit();
}
