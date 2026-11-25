import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

export function EntryContentHeader({
  entryTitle,
  contentTitle,
  children,
  className,
  showEntryTitle = true,
  entryTitleTooltip = false
}: {
  entryTitle: string;
  contentTitle: ReactNode;
  children?: ReactNode;
  className?: string;
  showEntryTitle?: boolean;
  entryTitleTooltip?: boolean;
}) {
  const title = <div
    className={cn('entry-content-header-entry-title mt-0.5 truncate text-xs leading-4 text-muted-foreground', entryTitleTooltip && 'rounded-sm focus-visible:outline-2 focus-visible:outline-ring')}
    title={entryTitleTooltip ? undefined : entryTitle}
    tabIndex={entryTitleTooltip ? 0 : undefined}
  >{entryTitle}</div>;
  return (
    <div
      className={cn(
        'entry-content-header flex min-w-0 flex-wrap items-center gap-3 border-b bg-background px-4 py-2.5',
        className
      )}
    >
      <div className="entry-content-header-title min-w-40 flex-1">
        <div className="truncate text-sm font-semibold leading-5 text-foreground">
          {contentTitle}
        </div>
        {showEntryTitle ? entryTitleTooltip ? <TooltipProvider><Tooltip>
          <TooltipTrigger asChild>{title}</TooltipTrigger>
          <TooltipContent side="bottom" align="start" className="max-h-[min(50vh,20rem)] max-w-[min(30rem,var(--radix-tooltip-content-available-width))] overflow-auto whitespace-pre-wrap break-words">{entryTitle}</TooltipContent>
        </Tooltip></TooltipProvider> : title : null}
      </div>
      {children ? (
        <div className="entry-content-header-actions flex min-w-0 flex-initial flex-wrap items-center justify-end gap-1.5">
          <Fragment>{children}</Fragment>
        </div>
      ) : null}
    </div>
  );
}
