'use client';

import { useEffect } from 'react';
import { ingestParentStudioMessage } from '@/lib/embed/apply-parent';
import { isEmbeddedMode, markEmbeddedFromQuery } from '@/lib/embed/mode';
import { installEmbeddedNovaAuthIntercept } from '@/lib/embed/nova-auth-fetch';

function applyThemeFromParent(theme?: 'dark' | 'light' | 'system'): void {
  if (typeof document === 'undefined') return;
  try {
    if (theme === 'dark' || theme === 'light') {
      document.documentElement.setAttribute('data-theme', theme);
      return;
    }
    if (theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
      return;
    }
    if (window.parent && window.parent !== window) {
      const root = window.parent.document.documentElement;
      const parentTheme = root.getAttribute('data-theme') || root.dataset.theme || '';
      const isDark = root.classList.contains('dark') || parentTheme === 'dark';
      const isLight = root.classList.contains('light') || parentTheme === 'light';
      if (isDark) document.documentElement.setAttribute('data-theme', 'dark');
      else if (isLight) document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch {
    // 跨域或父页不可读时忽略
  }
}

declare global {
  interface Window {
    __novaEmbedQueue?: unknown[];
    __novaEmbedIngest?: (data: unknown) => void;
  }
}

function ingestAndTheme(data: unknown): void {
  const result = ingestParentStudioMessage(data);
  if (result === 'config') {
    const theme = (data as { theme?: 'dark' | 'light' | 'system' }).theme;
    applyThemeFromParent(theme);
  }
}

export function EmbedBridge() {
  useEffect(() => {
    markEmbeddedFromQuery();
    if (isEmbeddedMode()) applyThemeFromParent();

    const uninstallAuth = installEmbeddedNovaAuthIntercept();
    window.__novaEmbedIngest = ingestAndTheme;
    const queued = window.__novaEmbedQueue || [];
    window.__novaEmbedQueue = [];
    for (const item of queued) ingestAndTheme(item);

    return () => {
      uninstallAuth();
      if (window.__novaEmbedIngest === ingestAndTheme) {
        window.__novaEmbedIngest = undefined;
      }
    };
  }, []);

  return null;
}
