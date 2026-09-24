import type { KeyboardEventHandler, ReactNode, Ref } from 'react';

import { Button } from '@/components/ui/button';
import { DisclosureIcon } from '@/components/ui/disclosure-icon';
import { cn } from '@/lib/utils';

export function SidebarSectionHeader({
  action,
  className,
  label,
  open,
  controlsId,
  toggleLabel,
  variant = 'section',
  count,
  hint,
  buttonRef,
  onKeyDown,
  onToggle
}: {
  action?: ReactNode;
  className?: string;
  label: string;
  open?: boolean;
  controlsId?: string;
  toggleLabel?: string;
  variant?: 'section' | 'branch';
  count?: number;
  hint?: string;
  buttonRef?: Ref<HTMLButtonElement>;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onToggle?: () => void;
}) {
  return (
    <div
      data-material={variant === 'branch' ? 'content-row' : 'section-heading'}
      data-sidebar-branch-heading={variant === 'branch' || undefined}
      data-interactive={variant === 'branch' || undefined}
      className={cn(
        'flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground',
        variant === 'branch' && 'px-0 text-xs text-foreground hover:bg-muted',
        className
      )}
    >
      {onToggle ? (
        <Button
          ref={buttonRef}
          data-sidebar-disclosure={variant === 'branch' || undefined}
          aria-expanded={open}
          aria-controls={controlsId}
          aria-label={toggleLabel}
          className={cn('-ml-1 h-7 min-w-0 flex-1 justify-start gap-1.5 px-1 text-[11px] font-medium text-muted-foreground hover:bg-muted',
            variant === 'branch' && 'ml-0 gap-2 px-2 text-xs text-foreground')}
          size="sm"
          type="button"
          variant="plain"
          onClick={onToggle}
          onKeyDown={event => {
            onKeyDown?.(event);
            if (event.defaultPrevented) return;
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            if ((event.key === 'ArrowRight') !== Boolean(open)) onToggle();
          }}
        >
          <DisclosureIcon open={open} className={variant === 'branch' ? 'size-4' : undefined} />
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          {hint && <span className="shrink-0 text-[10px] font-normal text-primary">{hint}</span>}
          {count !== undefined && <span className="shrink-0 text-[10px] font-normal tabular-nums text-muted-foreground">{count}</span>}
        </Button>
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}
