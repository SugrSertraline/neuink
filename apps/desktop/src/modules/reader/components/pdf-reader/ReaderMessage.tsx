import { FileText } from 'lucide-react';
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function ReaderMessage({
  action,
  description,
  icon,
  title,
  tone = 'default'
}: {
  action?: ReactNode;
  description: string;
  icon?: ReactNode;
  title: string;
  tone?: 'default' | 'danger';
}) {
  return (
    <div className="grid min-h-[520px] place-items-center rounded-md border bg-muted/20 text-center">
      <div className="grid max-w-md gap-3">
        <div
          className={cn(
            'mx-auto grid size-12 place-items-center rounded-md bg-white ring-1 ring-border',
            tone === 'danger' ? 'text-destructive' : 'text-primary'
          )}
        >
          {icon ?? <FileText size={22} aria-hidden="true" />}
        </div>

        <div>
          <div className="font-semibold">{title}</div>

          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            {description}
          </div>
        </div>

        {action ? <div className="flex justify-center">{action}</div> : null}
      </div>
    </div>
  );
}
