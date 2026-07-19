import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function ReaderSurfaceBody({
  children,
  className,
  width = 'wide'
}: {
  children: ReactNode;
  className?: string;
  width?: 'reading' | 'wide' | 'full';
}) {
  return (
    <div className={cn('min-h-0 overflow-auto px-4 py-4 sm:px-6 sm:py-5', className)}>
      <div
        className={cn(
          'mx-auto grid min-w-0 gap-4',
          width === 'reading' && 'max-w-3xl',
          width === 'wide' && 'max-w-5xl',
          width === 'full' && 'max-w-none'
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function ReaderModeSwitch<T extends string>({
  items,
  value,
  onValueChange,
  className
}: {
  items: Array<{
    badge?: number | string | null;
    disabled?: boolean;
    label: string;
    value: T;
  }>;
  value: T | null;
  onValueChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      aria-label="内容模式"
      className={cn('grid min-w-0 grid-flow-col auto-cols-fr gap-1 rounded-md bg-muted p-1', className)}
      role="tablist"
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Button
            aria-selected={active}
            className={cn('w-full', active && 'bg-background shadow-sm hover:bg-background')}
            disabled={item.disabled}
            key={item.value}
            role="tab"
            size="xs"
            type="button"
            variant="ghost"
            onClick={() => onValueChange(item.value)}
          >
            {item.label}
            {item.badge !== null && item.badge !== undefined ? (
              <Badge variant={active ? 'secondary' : 'outline'}>{item.badge}</Badge>
            ) : null}
          </Button>
        );
      })}
    </div>
  );
}

export function ReaderEmptyState({
  action,
  className,
  description,
  icon: Icon,
  title
}: {
  action?: ReactNode;
  className?: string;
  description: ReactNode;
  icon?: LucideIcon;
  title: ReactNode;
}) {
  return (
    <div
      className={cn(
        'grid min-h-40 place-items-center rounded-lg border border-dashed bg-muted/20 px-6 py-10 text-center',
        className
      )}
    >
      <div className="grid max-w-sm justify-items-center gap-2.5">
        {Icon ? (
          <div className="grid size-10 place-items-center rounded-md border bg-background text-muted-foreground shadow-sm">
            <Icon aria-hidden="true" size={18} />
          </div>
        ) : null}
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <div className="text-sm leading-6 text-muted-foreground">{description}</div>
        {action ? <div className="pt-1">{action}</div> : null}
      </div>
    </div>
  );
}

export function ReaderSection({
  actions,
  children,
  className,
  description,
  title
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  description?: ReactNode;
  title: ReactNode;
}) {
  return (
    <section className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      <div className="flex min-w-0 items-start justify-between gap-3 border-b px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description ? (
            <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="shrink-0">{actions}</div> : null}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export const readerSelectableItemClass =
  'group block w-full rounded-lg border bg-card px-4 py-3 text-left transition-colors hover:border-primary/25 hover:bg-muted/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40';
