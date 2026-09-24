import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function EntryContentHeader({
  entryTitle,
  contentTitle,
  children,
  className,
  showEntryTitle = true
}: {
  entryTitle: string;
  contentTitle: ReactNode;
  children?: ReactNode;
  className?: string;
  showEntryTitle?: boolean;
}) {
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
        {showEntryTitle ? <div
          className="entry-content-header-entry-title mt-0.5 truncate text-xs leading-4 text-muted-foreground"
          title={entryTitle}
        >
          {entryTitle}
        </div> : null}
      </div>
      {children ? (
        <div className="entry-content-header-actions flex min-w-0 flex-initial flex-wrap items-center justify-end gap-1.5">
          <Fragment>{children}</Fragment>
        </div>
      ) : null}
    </div>
  );
}
