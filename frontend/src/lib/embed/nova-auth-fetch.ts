import { getSessionToken, isEmbeddedMode } from '@/lib/embed/mode';

type FetchFn = typeof fetch;

let fetchRestore: (() => void) | null = null;
let xhrRestore: (() => void) | null = null;

function resolveRequestUrl(input: RequestInfo | URL, baseHref?: string): string {
  if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url;
  return String(input);
}

/**
 * 仅同源 Nova 后端 `/api/nova/*` 需要面板 JWT。
 * `/v1/...` 是 Sub2API 网关，用的是 image/text apiKey，禁止夹带 sessionToken。
 */
export function shouldAttachSessionToken(input: RequestInfo | URL): boolean {
  try {
    const href = resolveRequestUrl(input);
    const base = typeof window !== 'undefined' ? window.location.href : 'http://localhost/';
    const parsed = new URL(href, base);
    return /(?:^|\/)api\/nova(?:\/|$)/.test(parsed.pathname);
  } catch {
    return /(?:^|\/)api\/nova(?:\/|$)/.test(String(input));
  }
}

export function withSessionTokenHeaders(init: RequestInit | undefined, token: string): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return { ...init, headers };
}

function applyTokenToRequest(input: RequestInfo | URL, init: RequestInit | undefined, token: string): {
  input: RequestInfo | URL;
  init?: RequestInit;
} {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    if (input.headers.has('Authorization')) return { input, init };
    const headers = new Headers(input.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return { input: new Request(input, { headers }), init };
  }
  return { input, init: withSessionTokenHeaders(init, token) };
}

export function installEmbeddedNovaAuthFetch(): () => void {
  if (typeof window === 'undefined' || typeof window.fetch !== 'function') return () => undefined;
  if (fetchRestore) return fetchRestore;

  const original = window.fetch.bind(window) as FetchFn;
  const wrapped: FetchFn = (input, init) => {
    const token = isEmbeddedMode() ? getSessionToken() : '';
    if (token && shouldAttachSessionToken(input)) {
      const next = applyTokenToRequest(input, init, token);
      return original(next.input as RequestInfo, next.init);
    }
    return original(input as RequestInfo, init);
  };
  window.fetch = wrapped;
  fetchRestore = () => {
    window.fetch = original;
    fetchRestore = null;
  };
  return fetchRestore;
}

export function installEmbeddedNovaAuthXHR(): () => void {
  if (typeof XMLHttpRequest === 'undefined') return () => undefined;
  if (xhrRestore) return xhrRestore;

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  type AuthedXHR = XMLHttpRequest & { __novaAuthUrl?: string };

  XMLHttpRequest.prototype.open = function (this: AuthedXHR, method: string, url: string | URL, async?: boolean, username?: string | null, password?: string | null) {
    this.__novaAuthUrl = String(url);
    return originalOpen.call(this, method, url, async ?? true, username, password);
  };

  XMLHttpRequest.prototype.send = function (this: AuthedXHR, body?: Document | XMLHttpRequestBodyInit | null) {
    const token = isEmbeddedMode() ? getSessionToken() : '';
    const url = this.__novaAuthUrl || '';
    if (token && shouldAttachSessionToken(url)) {
      try {
        this.setRequestHeader('Authorization', `Bearer ${token}`);
      } catch {
        // header 已设或请求状态不允许时忽略
      }
    }
    return originalSend.call(this, body);
  };

  xhrRestore = () => {
    XMLHttpRequest.prototype.open = originalOpen;
    XMLHttpRequest.prototype.send = originalSend;
    xhrRestore = null;
  };
  return xhrRestore;
}

export function installEmbeddedNovaAuthIntercept(): () => void {
  const restoreFetch = installEmbeddedNovaAuthFetch();
  const restoreXhr = installEmbeddedNovaAuthXHR();
  return () => {
    restoreFetch();
    restoreXhr();
  };
}

export function uninstallEmbeddedNovaAuthIntercept(): void {
  fetchRestore?.();
  xhrRestore?.();
}
