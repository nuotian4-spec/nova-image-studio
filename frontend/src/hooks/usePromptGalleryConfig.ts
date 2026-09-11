'use client';

import { useEffect, useState } from 'react';
import { isEmbeddedMode, subscribeEmbedRuntime } from '@/lib/embed/mode';

// 1 = 常驻（直接显示） 2 = 私密（需密码） 3 = 关闭（完全隐藏）
export type PromptGalleryMode = '1' | '2' | '3';

export function usePromptGalleryConfig() {
  const [mode, setMode] = useState<PromptGalleryMode>(isEmbeddedMode() ? '1' : '2');
  const [passwordEnabled, setPasswordEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const applyEmbedded = () => {
      if (!isEmbeddedMode()) return false;
      setMode('1');
      setPasswordEnabled(false);
      return true;
    };

    if (applyEmbedded()) {
      return subscribeEmbedRuntime(() => { applyEmbedded(); });
    }

    fetch('/api/nova/config', { cache: 'no-store' })
      .then(res => res.json())
      .then((data: { promptGalleryMode?: string; promptGalleryPasswordEnabled?: boolean }) => {
        if (cancelled || isEmbeddedMode()) return;
        const raw = data.promptGalleryMode;
        setMode(raw === '1' || raw === '3' ? raw : '2');
        setPasswordEnabled(Boolean(data.promptGalleryPasswordEnabled));
      })
      .catch(() => {
        // 网络失败时保持默认值 '2'
      });

    const unsub = subscribeEmbedRuntime(() => {
      if (applyEmbedded()) cancelled = true;
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  return { mode, passwordEnabled };
}
