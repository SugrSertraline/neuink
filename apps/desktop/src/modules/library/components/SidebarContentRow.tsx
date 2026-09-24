import type { KeyboardEventHandler, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card';

export function SidebarContentRow({
  active,
  icon,
  label,
  labelContent,
  meta,
  metaContent,
  details,
  preview,
  multiline = false,
  density = 'default',
  leading,
  action,
  onContextMenu,
  disabled = false,
  onKeyDown,
  onClick
}: {
  active: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  label: string;
  labelContent?: ReactNode;
  meta: string;
  metaContent?: ReactNode;
  details?: ReactNode;
  preview?: ReactNode;
  multiline?: boolean;
  density?: 'default' | 'compact';
  leading?: ReactNode;
  action?: ReactNode;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown?: KeyboardEventHandler<HTMLButtonElement>;
  onClick: () => void;
}) {
  const button = <button
    data-material="content-row-main"
    className="flex w-full min-w-0 max-w-full flex-1 items-center gap-2 overflow-hidden rounded-sm px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 disabled:opacity-60"
    disabled={disabled}
    aria-current={active ? 'page' : undefined}
    title={preview ? undefined : `${label}\n${meta}`}
    type="button"
    onKeyDown={onKeyDown}
    onClick={onClick}
  >
    {icon ? <span className="grid size-4 shrink-0 place-items-center">{icon}</span> : null}
    <span className="w-0 min-w-0 flex-1 overflow-hidden">
      <span className={cn(multiline ? 'line-clamp-2 py-1 text-[13px] font-medium leading-5' : 'block truncate')}>{label}</span>
      <span className={density === 'compact' ? 'sr-only' : 'block truncate text-[10px] font-medium text-muted-foreground'}>{density === 'compact' ? meta : metaContent ?? meta}</span>
    </span>
    {density === 'compact' && metaContent ? <span aria-hidden="true" className="shrink-0 text-[10px] font-normal text-muted-foreground">{metaContent}</span> : null}
  </button>;
  return (
    <div
      data-material="content-row"
      data-active={active}
      data-interactive={!labelContent && !disabled}
      data-density={density}
      className={cn(
        'flex min-h-7 w-full min-w-0 items-center gap-1 overflow-hidden rounded-md border border-transparent text-xs transition-colors',
        details && 'flex-wrap gap-y-0',
        multiline ? active ? 'border-primary/25 bg-primary/5 text-foreground' : 'text-foreground hover:bg-muted/60' : active
          ? 'border-primary/20 bg-accent font-bold text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        density === 'compact' && (active ? 'font-medium' : 'text-foreground')
      )}
      onContextMenu={onContextMenu}
    >
      {leading ? <span className="flex shrink-0 items-center pl-0.5">{leading}</span> : null}
      {labelContent ? (
        <div className="flex w-full min-w-0 max-w-full flex-1 items-center gap-2 overflow-hidden px-2 py-1 text-left">
          {icon ? <span className="grid size-4 shrink-0 place-items-center">{icon}</span> : null}
          <span className="w-0 min-w-0 flex-1 overflow-hidden">
            {labelContent}
            <span className="block truncate text-[10px] font-medium text-muted-foreground">{metaContent ?? meta}</span>
          </span>
        </div>
      ) : preview ? <HoverCard>
        <HoverCardTrigger asChild>{button}</HoverCardTrigger>
        <HoverCardContent side="right" align="start" className="w-80">{preview}</HoverCardContent>
      </HoverCard> : button}
      {action ? <span className="shrink-0 pr-1">{action}</span> : null}
      {details ? <div className="w-full min-w-0 px-3 pb-3 pt-2 font-normal">{details}</div> : null}
    </div>
  );
}
