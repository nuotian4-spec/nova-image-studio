'use client';

import { withBasePath } from '@/lib/embed/public-path';
import { cn } from '@/lib/utils';

type BrandLockupSize = 'header' | 'sidebar' | 'compact';

export function BrandLockup({
  size = 'header',
  className,
}: {
  size?: BrandLockupSize;
  className?: string;
}) {
  const markSrc = withBasePath('/brand-mark.png');
  const compact = size === 'compact';
  const sidebar = size === 'sidebar';

  return (
    <span className={cn('flex min-w-0 items-center', compact ? 'gap-2' : 'gap-2.5', className)}>
      <img
        src={markSrc}
        alt=""
        className={cn('w-auto shrink-0', compact || sidebar ? 'h-8' : 'h-8 sm:h-10')}
      />
      <span className="min-w-0">
        <span
          className={cn(
            'block truncate font-semibold leading-tight',
            sidebar ? 'text-base' : compact ? 'text-sm' : 'text-base sm:text-[22px]',
          )}
        >
          麦迅工坊
        </span>
        {!compact && (
          <span className={cn('block truncate text-muted-foreground leading-tight', sidebar ? 'text-[11px]' : 'hidden text-[13px] sm:block')}>
            生图 · 对话
          </span>
        )}
      </span>
    </span>
  );
}
