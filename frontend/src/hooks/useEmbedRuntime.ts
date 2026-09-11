'use client';

import { useMemo, useSyncExternalStore } from 'react';
import {
  getCompleteImageModels,
  getCompleteTextModels,
  loadRegistry,
} from '@/lib/nova-models';
import {
  getEmbedRuntimeState,
  isEmbeddedMode,
  shouldHideByokSettings,
  shouldHideVideo,
  subscribeEmbedRuntime,
} from '@/lib/embed/mode';

export interface EmbedRuntimeView {
  enabled: boolean;
  hideVideo: boolean;
  hideByokSettings: boolean;
  waitingForConfig: boolean;
  hasImageKey: boolean;
  hasTextKey: boolean;
  imageLabels: string[];
  textLabels: string[];
  theme?: 'dark' | 'light' | 'system';
}

let cachedSnapshot: EmbedRuntimeView | null = null;
let cachedSignature = '';

function getSnapshot(): EmbedRuntimeView {
  const state = getEmbedRuntimeState();
  const enabled = isEmbeddedMode();
  const registry = loadRegistry();
  const imageModels = getCompleteImageModels(registry);
  const textModels = getCompleteTextModels(registry);
  const next: EmbedRuntimeView = {
    enabled,
    hideVideo: shouldHideVideo(),
    hideByokSettings: shouldHideByokSettings(),
    waitingForConfig: enabled && !state.configReceived,
    hasImageKey: imageModels.length > 0,
    hasTextKey: textModels.length > 0,
    imageLabels: imageModels.map((model) => model.name || model.modelId),
    textLabels: textModels.map((model) => model.name || model.modelId),
    theme: state.theme,
  };
  const signature = JSON.stringify(next);
  if (cachedSnapshot && cachedSignature === signature) return cachedSnapshot;
  cachedSnapshot = next;
  cachedSignature = signature;
  return next;
}

const SERVER_SNAPSHOT: EmbedRuntimeView = {
  enabled: false,
  hideVideo: false,
  hideByokSettings: false,
  waitingForConfig: false,
  hasImageKey: false,
  hasTextKey: false,
  imageLabels: [],
  textLabels: [],
};

export function useEmbedRuntime(): EmbedRuntimeView {
  const snapshot = useSyncExternalStore(subscribeEmbedRuntime, getSnapshot, () => SERVER_SNAPSHOT);
  return useMemo(() => snapshot, [snapshot]);
}
