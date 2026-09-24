import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { HOVER_TIMING, useHoverOpenState } from './hover-interactions'
import { ViewportOverlay } from './viewport-overlay'

const TooltipOpenContext = React.createContext(() => {})

function TooltipProvider({
  delayDuration = HOVER_TIMING.tooltip,
  skipDelayDuration = HOVER_TIMING.skip,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      skipDelayDuration={skipDelayDuration}
      {...props}
    />
  )
}

function Tooltip({
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  const state = useHoverOpenState({ open: controlledOpen, defaultOpen, onOpenChange })
  return <TooltipOpenContext.Provider value={state.show}>
    <TooltipPrimitive.Root data-slot="tooltip" {...props} open={state.open} onOpenChange={state.onOpenChange} />
  </TooltipOpenContext.Provider>
}

const TooltipTrigger = React.forwardRef<React.ElementRef<typeof TooltipPrimitive.Trigger>, React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Trigger>>(function TooltipTrigger({
  onPointerMove,
  ...props
}, ref) {
  const show = React.useContext(TooltipOpenContext)
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} ref={ref}
    onPointerMove={(event) => {
      onPointerMove?.(event)
      if (!event.defaultPrevented && event.pointerType !== 'touch') {
        show()
        // Opening is synchronous; do not also start Radix's delayed-open timer.
        event.preventDefault()
      }
    }} />
})

function TooltipContent({
  className,
  sideOffset = 6,
  collisionPadding = 8,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <ViewportOverlay enabled layer="tooltip">
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        collisionPadding={collisionPadding}
        hideWhenDetached
        className={cn(
          "inline-flex w-fit max-w-[min(20rem,var(--radix-tooltip-content-available-width))] max-h-[var(--radix-tooltip-content-available-height)] items-center gap-1.5 overflow-hidden break-words rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-4 text-background shadow-sm has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:rounded-sm",
          className
        )}
        {...props}
      >
        {children}
        <TooltipPrimitive.Arrow className="fill-foreground" width={8} height={4} />
      </TooltipPrimitive.Content>
      </ViewportOverlay>
    </TooltipPrimitive.Portal>
  )
}

export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger }
