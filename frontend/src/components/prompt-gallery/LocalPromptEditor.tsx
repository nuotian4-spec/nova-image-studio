'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { LocalPromptType } from '@/lib/prompt-gallery-types';

function OverlayDialog({
  title,
  children,
  onClose,
  busy,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
  busy?: boolean;
}) {
  const [isClosing, setIsClosing] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    requestAnimationFrame(() => setIsMounted(true));
    return () => {
      document.body.style.removeProperty('overflow');
      document.body.style.removeProperty('position');
      document.body.style.removeProperty('top');
      document.body.style.removeProperty('width');
      window.scrollTo(0, scrollY);
    };
  }, []);

  const handleClose = () => {
    if (busy || isClosing) return;
    setIsClosing(true);
    setTimeout(onClose, 150);
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-stretch justify-center overflow-y-auto bg-black/50 transition-opacity duration-150 sm:items-center sm:p-4 ${
        isMounted && !isClosing ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh' }}
      onClick={handleClose}
      onWheel={event => event.stopPropagation()}
      onTouchMove={event => event.stopPropagation()}
    >
      <div
        className={`flex min-h-[100dvh] w-full flex-col overflow-y-auto rounded-none border border-border bg-card p-6 pt-12 shadow-lg transition-all duration-150 sm:min-h-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-lg sm:rounded-xl sm:pt-6 ${
          isMounted && !isClosing ? 'scale-100 opacity-100' : 'scale-95 opacity-0'
        }`}
        onClick={event => event.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function guardClose(busy: boolean | undefined, onClose: () => void) {
  if (busy) return;
  onClose();
}

export function LocalPromptFormDialog({
  mode,
  initialTitle = '',
  initialContent = '',
  initialType = 1,
  error,
  submitting,
  onClose,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  initialTitle?: string;
  initialContent?: string;
  initialType?: LocalPromptType;
  error?: string | null;
  submitting?: boolean;
  onClose: () => void;
  onSubmit: (payload: { title: string; content: string; type: LocalPromptType; password: string }) => void;
}) {
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [type, setType] = useState<LocalPromptType>(initialType);
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = () => {
    const nextTitle = title.trim();
    const nextContent = content.trim();
    if (!nextTitle) {
      setLocalError('请填写标题');
      return;
    }
    if (!nextContent) {
      setLocalError('请填写正文');
      return;
    }
    if (!password) {
      setLocalError('请输入口令');
      return;
    }
    setLocalError(null);
    onSubmit({ title: nextTitle, content: nextContent, type, password });
  };

  return (
    <OverlayDialog title={mode === 'create' ? '添加本站模板' : '编辑本站模板'} busy={submitting} onClose={() => guardClose(submitting, onClose)}>
      <div className="space-y-4">
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">标题</span>
          <Input value={title} onChange={event => setTitle(event.target.value)} placeholder="模板标题" />
        </label>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">正文</span>
          <Textarea
            value={content}
            onChange={event => setContent(event.target.value)}
            placeholder="提示词正文"
            className="min-h-32"
          />
        </label>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">类型</span>
          <div className="flex w-fit rounded-lg border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setType(1)}
              className={`h-7 rounded-md px-3 text-sm transition-colors ${
                type === 1 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              文生图
            </button>
            <button
              type="button"
              onClick={() => setType(2)}
              className={`h-7 rounded-md px-3 text-sm transition-colors ${
                type === 2 ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              图生图
            </button>
          </div>
        </div>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">口令</span>
          <Input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') handleSubmit();
            }}
            placeholder="写入本站模板需要口令"
            autoComplete="current-password"
          />
        </label>
        {(localError || error) && (
          <p className="text-sm text-destructive">{localError || error}</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => guardClose(submitting, onClose)} disabled={submitting}>
            取消
          </Button>
          <Button size="sm" onClick={handleSubmit} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            {mode === 'create' ? '添加' : '保存'}
          </Button>
        </div>
      </div>
    </OverlayDialog>
  );
}

export function LocalPromptDeleteDialog({
  promptTitle,
  error,
  submitting,
  onClose,
  onConfirm,
}: {
  promptTitle: string;
  error?: string | null;
  submitting?: boolean;
  onClose: () => void;
  onConfirm: (password: string) => void;
}) {
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handleConfirm = () => {
    if (!password) {
      setLocalError('请输入口令');
      return;
    }
    setLocalError(null);
    onConfirm(password);
  };

  return (
    <OverlayDialog title="删除本站模板" busy={submitting} onClose={() => guardClose(submitting, onClose)}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          确定删除「{promptTitle}」？此操作只影响本站模板，不可恢复。
        </p>
        <label className="block space-y-1.5">
          <span className="text-sm font-medium">口令</span>
          <Input
            type="password"
            value={password}
            onChange={event => setPassword(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter') handleConfirm();
            }}
            placeholder="删除需要口令"
            autoComplete="current-password"
            autoFocus
          />
        </label>
        {(localError || error) && (
          <p className="text-sm text-destructive">{localError || error}</p>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => guardClose(submitting, onClose)} disabled={submitting}>
            取消
          </Button>
          <Button variant="destructive" size="sm" onClick={handleConfirm} disabled={submitting}>
            {submitting && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            删除
          </Button>
        </div>
      </div>
    </OverlayDialog>
  );
}
