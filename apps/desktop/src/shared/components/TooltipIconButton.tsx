import type { ComponentProps, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/** The wrapper keeps disabled actions discoverable by hover and keyboard focus. */
export function TooltipIconButton({ label, tooltip = label, disabled, ...props }: Omit<ComponentProps<typeof Button>, 'size' | 'asChild' | 'title'> & {
  label: string;
  tooltip?: ReactNode;
}) {
  return <Tooltip>
    <TooltipTrigger asChild>
      <span className="inline-flex shrink-0 rounded-md focus-visible:outline-2 focus-visible:outline-ring" tabIndex={disabled ? 0 : undefined} aria-label={disabled ? label : undefined}>
        <Button {...props} type={props.type ?? 'button'} size="icon-sm" aria-label={label} disabled={disabled} />
      </span>
    </TooltipTrigger>
    <TooltipContent>{tooltip}</TooltipContent>
  </Tooltip>;
}
