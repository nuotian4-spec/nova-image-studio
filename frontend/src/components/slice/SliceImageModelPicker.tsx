'use client';

// 切图 Tab 内的图片模型选择器。
//
// 闭源版用的是全局 ModelPickerList（内置模型族 + 档位二级菜单），开源版没有
// 「模型族」概念——模型全由用户在设置里自建，所以这里就是一个平铺列表。
//
// 列出配置完整的生图模型：切图的 AI 透明化与背景补齐打 /v1/images/edits（含 mask），
// 由父站网关按当前出图分组路由，不在选择器层按 protocol 过滤。
//
// 嵌入模式下父站 postMessage 会改 registry：必须订阅更新，不能 useMemo([],) 把列表算死。

import { useMemo, useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';

import { getEmbedRuntimeState, isEmbeddedMode, subscribeEmbedRuntime } from '@/lib/embed/mode';
import { cn } from '@/lib/utils';
import {
  EMBED_SLICE_IMAGE_MISSING_HINT,
  listSliceImageModels,
  type SliceImageModel,
} from '@/lib/slice-model-config';

interface SliceImageModelPickerProps {
  /** 当前选中的 registry 条目 id */
  value: string;
  onSelect: (model: SliceImageModel) => void;
  className?: string;
}

function getSliceImageModelsSignature(): string {
  const embed = getEmbedRuntimeState();
  const models = listSliceImageModels();
  return JSON.stringify({
    embedded: embed.enabled || isEmbeddedMode(),
    revision: embed.revision,
    memory: embed.memoryRegistry?.imageModels.map((model) => `${model.id}:${model.protocol}`),
    ids: models.map((model) => model.id),
  });
}

export function SliceImageModelPicker({ value, onSelect, className }: SliceImageModelPickerProps) {
  const signature = useSyncExternalStore(
    subscribeEmbedRuntime,
    getSliceImageModelsSignature,
    () => '[]',
  );
  const models = useMemo(() => listSliceImageModels(), [signature]);

  if (models.length === 0) {
    if (isEmbeddedMode()) {
      return (
        <div className={cn('p-3 text-xs leading-relaxed text-muted-foreground', className)}>
          {EMBED_SLICE_IMAGE_MISSING_HINT}
        </div>
      );
    }
    return (
      <div className={cn('p-3 text-xs leading-relaxed text-muted-foreground', className)}>
        还没有可用于切图的图片模型。
        <br />
        {/* 独立站空态。嵌入模式已在上方分支返回，禁止把用户骗去 BYOK 设置。 */}
        请到「设置 → 模型」添加一个配置完整的图片模型。
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col', className)}>
      {models.map((model) => {
        const active = model.id === value;
        return (
          <button
            key={model.id}
            type="button"
            onClick={() => onSelect(model)}
            className={cn(
              'flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm hover:bg-muted',
              active && 'bg-muted font-medium',
            )}
          >
            <span className="min-w-0 flex-1 truncate">{model.displayName}</span>
            <span className="shrink-0 text-[11px] text-muted-foreground">{model.modelId}</span>
            {active && <Check className="size-3.5 shrink-0 opacity-70" />}
          </button>
        );
      })}
    </div>
  );
}

/** 触发按钮上的展示名。模型已被删除时退回一句提示而不是空白。 */
export function describeSliceImageModel(modelId: string): string {
  const models = listSliceImageModels();
  if (models.length === 0) return '未配置图片模型';
  return models.find((model) => model.id === modelId)?.displayName
    ?? models[0]?.displayName
    ?? '未配置图片模型';
}
