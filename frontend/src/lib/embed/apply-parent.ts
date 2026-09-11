import { syncDynamicModelExports } from '@/lib/gemini-config';
import { saveRegistry } from '@/lib/nova-models';
import {
  applyParentStudioMessage,
  getEmbeddedMemoryRegistry,
} from '@/lib/embed/mode';
import { buildRegistryFromParentConfig } from '@/lib/embed/parent-registry';
import {
  NOVA_STUDIO_CONFIG_TYPE,
  parseParentStudioMessage,
} from '@/lib/embed/protocol-map';

function dispatchRegistryUpdated(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('nova-model-registry-updated'));
}

export function ingestParentStudioMessage(data: unknown): 'config' | 'revoke' | 'ignored' {
  const parsed = parseParentStudioMessage(data);
  const result = applyParentStudioMessage(data);
  if (result === 'ignored' || !parsed) return 'ignored';

  if (result === 'revoke') {
    const empty = getEmbeddedMemoryRegistry();
    if (empty) saveRegistry(empty);
    syncDynamicModelExports();
    dispatchRegistryUpdated();
    return 'revoke';
  }

  if (parsed.type !== NOVA_STUDIO_CONFIG_TYPE) return 'ignored';
  const registry = buildRegistryFromParentConfig(parsed);
  saveRegistry(registry);
  syncDynamicModelExports();
  dispatchRegistryUpdated();
  return 'config';
}
