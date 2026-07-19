import { Fragment, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function EntryContentHeader({
  entryTitle,
  contentTitle,
  children,
  className
}: {
  entryTitle: string;
  contentTitle: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-wrap items-center gap-3 border-b bg-background px-4 py-2.5',
        className
      )}
    >
      <div className="min-w-40 flex-1">
        <div className="truncate text-sm font-semibold leading-5 text-foreground">
          {contentTitle}
        </div>
        <div
          className="mt-0.5 truncate text-xs leading-4 text-muted-foreground"
          title={entryTitle}
        >
          {entryTitle}
        </div>
      </div>
      {children ? (
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5">
          <Fragment>{children}</Fragment>
        </div>
      ) : null}
    </div>
  );
}
