import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getWorkspaceModeTabs } from '@/components/workspace/WorkspaceModeTabs';
import { ingestParentStudioMessage } from '@/lib/embed/apply-parent';
import {
  enableEmbeddedModeForTests,
  getSessionToken,
  isEmbeddedMode,
  readEmbeddedQuery,
  resetEmbedRuntimeForTests,
  shouldHideVideo,
} from '@/lib/embed/mode';
import {
  mapImageRequest,
  mapTextRequest,
  parseParentStudioMessage,
  persistedRegistryHasApiKey,
  shouldHideVideoTab,
  shouldPersistApiKey,
  stripApiKeysFromRegistry,
  type ParentNovaStudioConfig,
} from '@/lib/embed/protocol-map';
import {
  installEmbeddedNovaAuthIntercept,
  shouldAttachSessionToken,
  uninstallEmbeddedNovaAuthIntercept,
} from '@/lib/embed/nova-auth-fetch';
import { loadRegistry, saveRegistry } from '@/lib/nova-models';
import { hasImageApiKey, hasTextApiKey } from '@/lib/settings-storage';

const PARENT_BASE = 'https://parent.example/';

function parentConfig(overrides: Partial<ParentNovaStudioConfig> = {}): ParentNovaStudioConfig {
  return {
    type: 'sub2api:nova-studio-config',
    sessionId: 'sess-1',
    revision: 1,
    baseUrl: PARENT_BASE,
    uiMode: 'embedded',
    hideVideo: true,
    hideByokSettings: true,
    ...overrides,
  };
}

describe('Sub2API protocol → Nova protocol → 请求 URL', () => {
  it.each([
    ['openai_images', 'openai', 'v1/images/generations', 'v1/images/edits'],
    ['grok_images', 'grok', 'v1/images/generations', 'v1/images/edits'],
    ['gemini_generate_content', 'google', 'v1beta/models/gemini-3-pro-image-preview:generateContent', 'v1beta/models/gemini-3-pro-image-preview:generateContent'],
  ] as const)('%s → %s', (sub2api, nova, generationsPath, editsPath) => {
    const mapped = mapImageRequest(sub2api, PARENT_BASE, 'gemini-3-pro-image-preview');
    expect(mapped).not.toBeNull();
    expect(mapped?.novaProtocol).toBe(nova);
    expect(mapped?.generationsPath).toBe(generationsPath);
    expect(mapped?.editsPath).toBe(editsPath);
    expect(mapped?.generationsUrl).toBe(`${PARENT_BASE}${generationsPath}`);
    expect(mapped?.editsUrl).toBe(`${PARENT_BASE}${editsPath}`);
    expect(mapped?.generationsUrl).not.toContain('api.openai.com');
    expect(mapped?.generationsUrl).not.toContain('api.x.ai');
  });

  it.each([
    ['openai_chat_completions', 'openai-chat-completions', 'v1/chat/completions'],
    ['openai_responses', 'openai-responses', 'v1/responses'],
    ['anthropic_messages', 'anthropic-messages', 'v1/messages'],
    ['google_gemini', 'google-gemini', 'v1beta/models/gemini-2.5-flash:generateContent'],
  ] as const)('%s → %s → %s', (sub2api, nova, path) => {
    const mapped = mapTextRequest(sub2api, PARENT_BASE, 'gemini-2.5-flash');
    expect(mapped).not.toBeNull();
    expect(mapped?.novaProtocol).toBe(nova);
    expect(mapped?.path).toBe(path);
    expect(mapped?.url).toBe(`${PARENT_BASE}${path}`);
    expect(mapped?.url).not.toContain('api.openai.com');
  });
});

describe('hideVideo', () => {
  it('embedded 默认隐藏视频工作台 Tab', () => {
    expect(shouldHideVideoTab({ embedded: true })).toBe(true);
    expect(shouldHideVideoTab({ hideVideo: true })).toBe(true);
    expect(shouldHideVideoTab({ embedded: false, hideVideo: false })).toBe(false);
    const values = getWorkspaceModeTabs({ hideVideo: true }).map((tab) => tab.value);
    expect(values).not.toContain('video-generation');
    expect(values).toContain('image-generation');
  });

  it('readEmbeddedQuery 不依赖默认参数求值 window', () => {
    expect(readEmbeddedQuery('?embedded=1')).toBe(true);
    expect(readEmbeddedQuery('?foo=1')).toBe(false);
    expect(readEmbeddedQuery('')).toBe(false);
  });
});

describe('embedded 拒绝 persist apiKey', () => {
  beforeEach(() => {
    resetEmbedRuntimeForTests();
    localStorage.clear();
  });

  it('standalone 允许把 apiKey 写入 localStorage', () => {
    expect(shouldPersistApiKey({ embedded: false })).toBe(true);
    saveRegistry({
      imageModels: [{
        id: 'img-1',
        protocol: 'openai',
        name: 'GPT Image 2',
        modelId: 'gpt-image-2',
        apiKey: 'sk-standalone',
        baseUrl: 'https://api.openai.com',
        builtinPreset: 'gpt-image-2',
        maxRefImages: 16,
        maxOutputSize: '4K',
        supportsAdvancedParams: true,
      }],
      textModels: [{
        id: 'txt-1',
        protocol: 'openai-chat-completions',
        name: 'GPT',
        modelId: 'gpt-4o-mini',
        apiKey: 'sk-text',
        baseUrl: 'https://api.openai.com',
      }],
      defaults: {
        textToImage: 'img-1',
        imageToImage: 'img-1',
        reversePrompt: 'txt-1',
        agent: 'txt-1',
        promptOptimize: 'txt-1',
        imageDescribe: 'txt-1',
        sliceDecomposition: 'txt-1',
        sliceReconstruct: 'txt-1',
        sliceImageEdit: 'img-1',
      },
    });
    expect(persistedRegistryHasApiKey(localStorage.getItem('nova-model-registry'))).toBe(true);
  });

  it('embedded saveRegistry 把 apiKey 置空后再写入 localStorage，内存态仍可用', () => {
    enableEmbeddedModeForTests();
    expect(isEmbeddedMode()).toBe(true);
    expect(shouldPersistApiKey({ embedded: true })).toBe(false);
    expect(shouldHideVideo()).toBe(true);

    saveRegistry({
      imageModels: [{
        id: 'img-1',
        protocol: 'openai',
        name: 'GPT Image 2',
        modelId: 'gpt-image-2',
        apiKey: 'sk-secret-image',
        baseUrl: PARENT_BASE,
        builtinPreset: 'gpt-image-2',
        maxRefImages: 16,
        maxOutputSize: '4K',
        supportsAdvancedParams: true,
      }],
      textModels: [{
        id: 'txt-1',
        protocol: 'openai-responses',
        name: 'GPT',
        modelId: 'gpt-5.4-mini',
        apiKey: 'sk-secret-text',
        baseUrl: PARENT_BASE,
      }],
      defaults: {
        textToImage: 'img-1',
        imageToImage: 'img-1',
        reversePrompt: 'txt-1',
        agent: 'txt-1',
        promptOptimize: 'txt-1',
        imageDescribe: 'txt-1',
        sliceDecomposition: 'txt-1',
        sliceReconstruct: 'txt-1',
        sliceImageEdit: 'img-1',
      },
    });

    const persisted = localStorage.getItem('nova-model-registry');
    expect(persistedRegistryHasApiKey(persisted)).toBe(false);
    expect(JSON.parse(persisted || '{}').imageModels[0].apiKey).toBe('');
    expect(JSON.parse(persisted || '{}').textModels[0].apiKey).toBe('');

    const memory = loadRegistry();
    expect(memory.imageModels[0].apiKey).toBe('sk-secret-image');
    expect(memory.textModels[0].apiKey).toBe('sk-secret-text');
    expect(hasImageApiKey()).toBe(true);
    expect(hasTextApiKey()).toBe(true);
  });

  it('stripApiKeysFromRegistry 不会留下明文 Key', () => {
    const stripped = stripApiKeysFromRegistry({
      imageModels: [{ apiKey: 'sk-live' }],
      textModels: [{ apiKey: 'sk-text' }],
    });
    expect(stripped.imageModels[0].apiKey).toBe('');
    expect(stripped.textModels[0].apiKey).toBe('');
  });

  it('父页注入后缺哪边密钥就禁用哪边；revoke 清空内存密钥', () => {
    const result = ingestParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-image',
        keyId: 'img-key',
        model: 'gpt-image-2',
        protocol: 'openai_images',
        models: [{ model: 'gpt-image-2', protocol: 'openai_images' }],
      },
    }));
    expect(result).toBe('config');
    expect(hasImageApiKey()).toBe(true);
    expect(hasTextApiKey()).toBe(false);
    expect(loadRegistry().imageModels[0].baseUrl).toContain('parent.example');
    expect(loadRegistry().imageModels[0].protocol).toBe('openai');
    expect(persistedRegistryHasApiKey(localStorage.getItem('nova-model-registry'))).toBe(false);

    expect(ingestParentStudioMessage({ type: 'sub2api:nova-studio-revoke' })).toBe('revoke');
    expect(hasImageApiKey()).toBe(false);
    expect(hasTextApiKey()).toBe(false);
    expect(persistedRegistryHasApiKey(localStorage.getItem('nova-model-registry'))).toBe(false);
  });

  it('扁平信封回归：parse 仍能读出 image.apiKey', () => {
    const parsed = parseParentStudioMessage(parentConfig({
      image: {
        apiKey: 'sk-flat-image',
        keyId: 'img-key',
        model: 'gpt-image-2',
        protocol: 'openai_images',
      },
    }));
    expect(parsed && 'image' in parsed ? parsed.image?.apiKey : '').toBe('sk-flat-image');
  });

  it('嵌套 payload 的 config 能 ingest 出 image.apiKey', () => {
    const nested = {
      type: 'sub2api:nova-studio-config' as const,
      payload: {
        sessionId: 'sess-nested',
        revision: 2,
        baseUrl: PARENT_BASE,
        uiMode: 'embedded' as const,
        hideVideo: true,
        hideByokSettings: true,
        image: {
          apiKey: 'sk-nested-image',
          keyId: 'nested-key',
          model: 'gpt-image-2',
          protocol: 'openai_images',
          models: [{ model: 'gpt-image-2', protocol: 'openai_images' }],
        },
        text: {
          apiKey: 'sk-nested-text',
          model: 'gpt-4o-mini',
          protocol: 'openai_chat_completions',
        },
      },
    };
    const parsed = parseParentStudioMessage(nested);
    expect(parsed && 'image' in parsed ? parsed.image?.apiKey : '').toBe('sk-nested-image');
    expect(parsed && 'text' in parsed ? parsed.text?.apiKey : '').toBe('sk-nested-text');
    expect(parsed && 'sessionId' in parsed ? parsed.sessionId : '').toBe('sess-nested');

    expect(ingestParentStudioMessage(nested)).toBe('config');
    expect(hasImageApiKey()).toBe(true);
    expect(hasTextApiKey()).toBe(true);
    expect(loadRegistry().imageModels[0].apiKey).toBe('sk-nested-image');
    expect(persistedRegistryHasApiKey(localStorage.getItem('nova-model-registry'))).toBe(false);

    expect(ingestParentStudioMessage({
      type: 'sub2api:nova-studio-revoke',
      payload: { sessionId: 'sess-nested' },
    })).toBe('revoke');
    expect(hasImageApiKey()).toBe(false);
    expect(hasTextApiKey()).toBe(false);
  });

  it('拒绝把官方上游当 baseUrl，避免直连 api.openai.com / api.x.ai', () => {
    ingestParentStudioMessage(parentConfig({
      baseUrl: 'https://api.openai.com/',
      image: {
        apiKey: 'sk-image',
        model: 'gpt-image-2',
        protocol: 'openai_images',
      },
      text: {
        apiKey: 'sk-text',
        model: 'gpt-4o-mini',
        protocol: 'openai_chat_completions',
      },
    }));
    expect(hasImageApiKey()).toBe(false);
    expect(hasTextApiKey()).toBe(false);
  });
});

function localStorageBlob(): string {
  const parts: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key) continue;
    parts.push(`${key}=${localStorage.getItem(key) || ''}`);
  }
  return parts.join('\n');
}

function readAuthorization(input: RequestInfo | URL, init?: RequestInit): string | null {
  if (init?.headers) return new Headers(init.headers).get('Authorization');
  if (typeof Request !== 'undefined' && input instanceof Request) return input.headers.get('Authorization');
  return null;
}

describe('sessionToken 只给 /api/nova 加 Bearer，不 persist、不当 API Key', () => {
  const jwt = 'panel-jwt-session-token';
  let fetchCalls: Array<{ input: RequestInfo | URL; init?: RequestInit; auth: string | null }>;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    resetEmbedRuntimeForTests();
    localStorage.clear();
    uninstallEmbeddedNovaAuthIntercept();
    fetchCalls = [];
    originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ input, init, auth: readAuthorization(input, init) });
      return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    installEmbeddedNovaAuthIntercept();
  });

  afterEach(() => {
    uninstallEmbeddedNovaAuthIntercept();
    globalThis.fetch = originalFetch;
  });

  it('ingest payload.sessionToken 后 /api/nova/tasks 带 Bearer，/v1/ 网关不带，revoke 后不再带', async () => {
    expect(shouldAttachSessionToken('/api/nova/tasks')).toBe(true);
    expect(shouldAttachSessionToken('https://parent.example/v1/images/generations')).toBe(false);
    expect(shouldAttachSessionToken('/api/nova/ws')).toBe(true);

    const nested = {
      type: 'sub2api:nova-studio-config' as const,
      payload: {
        sessionId: 'sess-jwt',
        revision: 3,
        baseUrl: PARENT_BASE,
        uiMode: 'embedded' as const,
        hideVideo: true,
        hideByokSettings: true,
        sessionToken: jwt,
        image: {
          apiKey: 'sk-image-not-jwt',
          model: 'gpt-image-2',
          protocol: 'openai_images',
        },
      },
    };
    const parsed = parseParentStudioMessage(nested);
    expect(parsed && 'sessionToken' in parsed ? parsed.sessionToken : '').toBe(jwt);
    expect(ingestParentStudioMessage(nested)).toBe('config');
    expect(getSessionToken()).toBe(jwt);
    expect(loadRegistry().imageModels[0]?.apiKey).toBe('sk-image-not-jwt');
    expect(loadRegistry().imageModels[0]?.apiKey).not.toBe(jwt);
    expect(localStorageBlob()).not.toContain(jwt);

    await fetch('/api/nova/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(fetchCalls.at(-1)?.auth).toBe(`Bearer ${jwt}`);

    await fetch('https://parent.example/v1/images/generations', { method: 'POST' });
    expect(fetchCalls.at(-1)?.auth).toBeNull();

    const wsUrl = new URL('/api/nova/ws', 'https://parent.example/');
    expect(wsUrl.search).toBe('');
    expect(wsUrl.href).not.toContain(jwt);

    expect(ingestParentStudioMessage({ type: 'sub2api:nova-studio-revoke', payload: { sessionId: 'sess-jwt' } })).toBe('revoke');
    expect(getSessionToken()).toBe('');
    await fetch('/api/nova/tasks', { method: 'POST' });
    expect(fetchCalls.at(-1)?.auth).toBeNull();
    expect(localStorageBlob()).not.toContain(jwt);
  });
});

