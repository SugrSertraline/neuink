import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export function SidebarSectionHeader({
  action,
  className,
  label,
  open,
  controlsId,
  toggleLabel,
  onToggle
}: {
  action?: ReactNode;
  className?: string;
  label: string;
  open?: boolean;
  controlsId?: string;
  toggleLabel?: string;
  onToggle?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex h-7 min-w-0 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-muted-foreground',
        className
      )}
    >
      {onToggle ? (
        <Button
          aria-expanded={open}
          aria-controls={controlsId}
          aria-label={toggleLabel}
          className="-ml-1 h-7 min-w-0 flex-1 justify-start gap-1.5 px-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
          size="sm"
          type="button"
          variant="plain"
          onClick={onToggle}
          onKeyDown={event => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            if ((event.key === 'ArrowRight') !== Boolean(open)) onToggle();
          }}
        >
          {open ? (
            <ChevronDown size={13} aria-hidden="true" />
          ) : (
            <ChevronRight size={13} aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        </Button>
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </div>
  );
}
