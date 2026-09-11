'use client';

import { useEffect } from 'react';

/**
 * 监听 Service Worker 更新事件。
 * 新 SW 激活时自动刷新页面，避免旧 JS 与新组件树不匹配导致的渲染崩溃。
 */
export function ServiceWorkerManager() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    try {
      if (new URLSearchParams(window.location.search).get('embedded') === '1') {
        void navigator.serviceWorker.getRegistrations().then((regs) => {
          for (const reg of regs) void reg.unregister();
        });
        return;
      }
    } catch {
      // ignore
    }

    const handleControllerChange = () => {
      // 新 SW 接管后立即刷新，确保页面使用最新的 JS 包
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
    };
  }, []);

  return null;
}