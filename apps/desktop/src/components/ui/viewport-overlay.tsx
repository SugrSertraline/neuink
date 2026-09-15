import * as React from 'react';
import { Slot } from 'radix-ui';
import { cn } from '@/lib/utils';

const ViewportOverlayContext = React.createContext(false);

/** Opt-in scaled containing block for Radix portals; nested overlays inherit it. */
export const ViewportOverlay = React.forwardRef<HTMLDivElement, {
  enabled?: boolean;
  layer?: 'reader-preview' | 'popover' | 'dialog-popover' | 'tooltip';
  interactive?: boolean;
  children: React.ReactElement<{ className?: string }>;
}>(function ViewportOverlay({ enabled, layer = 'popover', interactive = true, children }, ref) {
  const inherited = React.useContext(ViewportOverlayContext);
  const aligned = enabled ?? inherited;
  return <ViewportOverlayContext.Provider value={aligned}>
    {aligned ? <div ref={ref} data-slot="overlay-viewport"
      className={cn('pointer-events-none fixed inset-0 [transform:translateZ(0)]', {
        'z-[var(--z-reader-preview)]': layer === 'reader-preview',
        'z-[var(--z-popover)]': layer === 'popover',
        'z-[var(--z-dialog-popover)]': layer === 'dialog-popover',
        'z-[var(--z-tooltip)]': layer === 'tooltip',
      })}>
      {React.cloneElement(children, { className: cn(children.props.className, interactive ? 'pointer-events-auto' : 'pointer-events-none') })}
    </div> : <Slot.Root ref={ref}>{children}</Slot.Root>}
  </ViewportOverlayContext.Provider>;
});
