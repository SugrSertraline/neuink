import * as React from "react"
import { HoverCard as HoverCardPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { HOVER_SURFACE_CLASS, HOVER_TIMING, useHoverOpenState } from './hover-interactions'
import { useOverlayLayer } from './overlay-layer'
import { ViewportOverlay } from './viewport-overlay'

const HoverOpenContext = React.createContext(() => {})

function HoverCard({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  openDelay = HOVER_TIMING.open,
  closeDelay = HOVER_TIMING.close,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  const state = useHoverOpenState({ open: controlledOpen, defaultOpen, onOpenChange })
  return <HoverOpenContext.Provider value={state.show}>
    <HoverCardPrimitive.Root data-slot="hover-card" {...props} open={state.open}
      openDelay={openDelay} closeDelay={closeDelay}
      onOpenChange={state.onOpenChange} />
  </HoverOpenContext.Provider>
}

function HoverCardTrigger({
  onPointerMove,
  onClick,
  openOnClick = false,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger> & { openOnClick?: boolean }) {
  const show = React.useContext(HoverOpenContext)
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props}
      onPointerMove={(event) => { onPointerMove?.(event); if (!event.defaultPrevented && event.pointerType !== 'touch') show() }}
      onClick={(event) => { onClick?.(event); if (openOnClick && !event.defaultPrevented) show() }} />
  )
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 8,
  collisionPadding = 12,
  layer,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content> & {
  layer?: 'reader-preview' | 'popover' | 'dialog-popover'
}) {
  const inheritedLayer = useOverlayLayer()
  return (
    <HoverCardPrimitive.Portal data-slot="hover-card-portal">
      <ViewportOverlay enabled layer={inheritedLayer === 'dialog-popover' ? inheritedLayer : layer ?? inheritedLayer}>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        data-hover-surface="true"
        align={align}
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        hideWhenDetached
        className={cn(
          HOVER_SURFACE_CLASS,
          "w-64 min-w-0 max-w-[var(--radix-hover-card-content-available-width)] max-h-[min(28rem,var(--radix-hover-card-content-available-height))] overflow-y-auto overscroll-contain break-words p-3 text-sm leading-5 outline-hidden",
          className
        )}
        {...props}
      />
      </ViewportOverlay>
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardTrigger, HoverCardContent }
