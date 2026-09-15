import * as React from "react"
import { Tooltip as TooltipPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { HOVER_TIMING, useHoverOpenState } from './hover-interactions'
import { ViewportOverlay } from './viewport-overlay'

const TooltipGateContext = React.createContext(() => {})

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
  return <TooltipGateContext.Provider value={state.rearm}>
    <TooltipPrimitive.Root data-slot="tooltip" {...props} open={state.open} onOpenChange={state.onOpenChange} />
  </TooltipGateContext.Provider>
}

function TooltipTrigger({
  onPointerEnter,
  onFocus,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const rearm = React.useContext(TooltipGateContext)
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props}
    onPointerEnter={(event) => { rearm(); onPointerEnter?.(event) }}
    onFocus={(event) => { rearm(); onFocus?.(event) }} />
}

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
          "inline-flex w-fit max-w-[min(20rem,var(--radix-tooltip-content-available-width))] max-h-[var(--radix-tooltip-content-available-height)] items-center gap-1.5 overflow-hidden break-words rounded-md bg-foreground px-2.5 py-1.5 text-xs leading-4 text-background shadow-sm has-data-[slot=kbd]:pr-1.5 **:data-[slot=kbd]:rounded-sm data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 duration-100 motion-reduce:animate-none",
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
