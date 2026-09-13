'use client';

import {
  ArrowUp,
  CloudUpload,
  Info,
  Link,
  Loader2,
  Sparkles,
  X,
} from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { AttachmentChips } from '@/components/AttachmentChips';
import { GptImageAdvancedParamsControl } from '@/components/GptImageAdvancedParamsControl';
import { cn } from '@/lib/utils';
import {
  GIF_MAX_REF_IMAGES,
  type GifModel,
} from '@/lib/gif-job-store';
import type { RefImageData } from '@/lib/job-store';
import { supportsGptImageAdvancedParams, type GptImageAdvancedParams } from '@/lib/model-capabilities';
import { useEmbedRuntime } from '@/hooks/useEmbedRuntime';

export interface GifUploadedRef extends RefImageData {
  preview: string;
  badge?: string;
}

export interface GifParametersPanelProps {
  prompt: string;
  onPromptChange: (value: string) => void;
  model: GifModel;
  modelOptions: { value: GifModel; label: string }[];
  modelPopoverOpen: boolean;
  onModelPopoverOpenChange: (open: boolean) => void;
  onModelChange: (value: GifModel) => void;
  gptImageAdvancedParams: GptImageAdvancedParams;
  onGptImageAdvancedParamsChange: (value: GptImageAdvancedParams) => void;
  closedLoop: boolean;
  onClosedLoopToggle: (value: boolean) => void;
  refFiles: GifUploadedRef[];
  onRemoveRef: (id: string) => void;
  maxedOut: boolean;
  isDragOver: boolean;
  uploading: boolean;
  uploadError: string | null;
  onDrop: (event: React.DragEvent) => void;
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: () => void;
  onFileSelect: (event: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
  generating: boolean;
  canSubmit: boolean;
  onSubmit: () => void;
  /** 真正缺密钥时走缺密钥弹窗；无 GIF 兼容模型时不要调用它。 */
  onConfigureApiKey: () => void;
  /** 独立模式下无兼容模型时打开设置，嵌入模式不展示。 */
  onOpenSettings?: () => void;
  onOptimize: () => void;
  onClear: () => void;
}

function formatModelLabel(model: GifModel, modelOptions: { value: GifModel; label: string }[]): string {
  return modelOptions.find(option => option.value === model)?.label || model;
}

export function GifParametersPanel(props: GifParametersPanelProps) {
  const embed = useEmbedRuntime();

  if (props.disabled) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/40 px-4 py-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-5 w-5" />
        </div>
        <div className="max-w-md">
          <p className="text-base font-medium text-foreground">需要先配置令牌</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {embed.enabled
              ? '请先在父站选出图密钥，才能使用动图生成功能。'
              : '请先在设置中配置 Nova API 密钥，才能使用动图生成功能。'}
          </p>
        </div>
        <Button onClick={props.onConfigureApiKey}>配置</Button>
      </div>
    );
  }

  if (props.modelOptions.length === 0) {
    return (
      <div className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted/40 px-4 py-8 text-center">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Info className="h-5 w-5" />
        </div>
        <div className="max-w-md">
          <p className="text-base font-medium text-foreground">没有可用的生图模型</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {embed.enabled
              ? '父站还没有注入生图模型，请在「出图」栏选择密钥'
              : '请在设置中配置生图模型后再使用动图生成。'}
          </p>
        </div>
        {!embed.enabled && props.onOpenSettings && (
          <Button onClick={props.onOpenSettings}>打开设置</Button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-muted/50 shadow-md md:h-[calc(100vh-400px)]">
      <div className="min-h-0 md:flex-1 md:overflow-y-auto">
        <div className="p-4">
          <div
            onDrop={props.onDrop}
            onDragOver={props.onDragOver}
            onDragLeave={props.onDragLeave}
            className={cn(
              'relative overflow-hidden rounded-xl border-2 border-dashed px-6 py-8 text-center transition-all',
              props.maxedOut
                ? 'cursor-not-allowed border-border bg-muted/40 text-muted-foreground'
                : props.isDragOver
                  ? 'border-primary bg-primary/20'
                  : 'cursor-pointer border-primary/30 bg-primary/5 hover:border-primary/50 hover:bg-primary/10',
            )}
          >
            <input
              type="file"
              accept="image/*"
              multiple
              disabled={props.uploading || props.maxedOut}
              onChange={props.onFileSelect}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
              style={{ fontSize: 0 }}
            />
            <CloudUpload className={cn('mx-auto mb-1 h-6 w-6', props.isDragOver ? 'text-primary' : 'text-muted-foreground')} />
            <p className="text-sm font-medium">
              {props.uploading
                ? '读取中...'
                : props.maxedOut
                  ? `已达到 ${GIF_MAX_REF_IMAGES} 张参考图上限`
                  : props.isDragOver
                    ? '将参考图拖放到这里'
                    : '可选：拖放或粘贴参考图'}
            </p>
            <p className="text-xs text-muted-foreground">最多 {GIF_MAX_REF_IMAGES} 张 · 当前 {props.refFiles.length} 张</p>
          </div>
        </div>

        {props.refFiles.length > 0 && (
          <div className="px-4 pb-2">
            <AttachmentChips
              files={props.refFiles}
              onRemove={props.onRemoveRef}
              sourceKind="gif"
              sourceLabel="GIF 参考图"
              prompt={props.prompt}
            />
          </div>
        )}

        <Textarea
          value={props.prompt}
          onChange={event => props.onPromptChange(event.target.value)}
          placeholder="描述动画主题 / 动作，例如：一只虎斑猫缓慢眨眼"
          rows={3}
          className="resize-none rounded-none border-0 bg-transparent placeholder:text-placeholder focus-visible:border-0 focus-visible:ring-0"
        />

        {props.uploadError && (
          <div className="px-4 pb-3">
            <p className="text-sm text-destructive">{props.uploadError}</p>
          </div>
        )}
      </div>

      <div className="flex-none border-t border-border/50 px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <Popover open={props.modelPopoverOpen} onOpenChange={props.onModelPopoverOpenChange}>
            <PopoverTrigger
              className={cn(buttonVariants({ variant: 'outline', size: 'xs' }), 'gap-1')}
              title="模型"
            >
              <Sparkles className="h-3 w-3" />
              <span className="shrink-0 truncate text-[11px]">{formatModelLabel(props.model, props.modelOptions)}</span>
            </PopoverTrigger>
            <PopoverContent className="w-48 p-1" align="start">
              {props.modelOptions.map(option => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    props.onModelChange(option.value);
                    props.onModelPopoverOpenChange(false);
                  }}
                  className={cn(
                    'w-full text-left px-2.5 py-1.5 rounded-md text-sm hover:bg-muted',
                    props.model === option.value && 'bg-muted font-medium',
                  )}
                >
                  {option.label}
                </button>
              ))}
              <p className="px-2.5 py-1 text-[11px] text-muted-foreground">列表来自当前可用的完整生图模型</p>
            </PopoverContent>
          </Popover>

          {supportsGptImageAdvancedParams(props.model) && (
            <GptImageAdvancedParamsControl
              value={props.gptImageAdvancedParams}
              onChange={props.onGptImageAdvancedParamsChange}
              variant="outline"
              size="xs"
            />
          )}

          <button
            type="button"
            onClick={() => props.onClosedLoopToggle(!props.closedLoop)}
            className={cn(
              buttonVariants({ variant: 'outline', size: 'xs' }),
              'gap-1',
              props.closedLoop ? 'border-primary text-primary' : '',
            )}
            title="首尾闭合：驱使模型生成闭环动画，第12帧无缝衔接回第1帧"
          >
            <Link className="h-3 w-3" />
            <span className="text-[11px]">首尾帧闭合</span>
          </button>

          <div className="ml-auto flex justify-end gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={props.onOptimize}
              disabled={!props.canSubmit}
              title="优化提示词"
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={props.onClear}
              disabled={!props.prompt.trim() && props.refFiles.length === 0}
              title="清空提示词和图片"
            >
              <X className="h-4 w-4" />
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={props.onSubmit}
              disabled={!props.canSubmit}
              className="gap-1"
            >
              {props.generating
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <ArrowUp className="h-4 w-4" />}
              <span>生成网格图</span>
            </Button>
          </div>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
          OpenAI 动图按 1536×1024 出 4×3 网格；其他模型使用其声明的最大输出档位。
        </p>
      </div>
    </div>
  );
}
