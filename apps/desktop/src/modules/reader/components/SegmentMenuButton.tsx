import { useId, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

// The coordinate-based segment menu owns focus and scrolling for all of its items.
export function SegmentMenuButton({ icon, label, description, className, onClick, onPointerDown, ...props }: Omit<ComponentProps<'button'>, 'children'> & {
  icon: ReactNode;
  label: string;
  description?: string;
}) {
  const descriptionId = useId();
  return <button
    type="button"
    role="menuitem"
    aria-label={label}
    aria-describedby={description ? descriptionId : undefined}
    {...props}
    className={cn('flex min-h-8 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm font-normal leading-5 hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0', className)}
    onClick={event => {
      event.preventDefault();
      event.stopPropagation();
      onClick?.(event);
    }}
    onPointerDown={event => {
      event.stopPropagation();
      onPointerDown?.(event);
    }}
  >
    {icon}
    <span className="min-w-0 flex-1">
      <span className="block">{label}</span>
      {description ? <span id={descriptionId} className="mt-0.5 block text-[11px] leading-4 text-muted-foreground">{description}</span> : null}
    </span>
  </button>;
}
