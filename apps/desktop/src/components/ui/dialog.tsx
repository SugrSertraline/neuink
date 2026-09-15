import * as React from "react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { XIcon } from "lucide-react"
import { OverlayLayerProvider } from './overlay-layer'

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(function DialogOverlay({ className, ...props }, ref) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-[var(--z-dialog)] bg-black/10 duration-100 supports-backdrop-filter:backdrop-blur-xs data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      ref={ref}
      {...props}
    />
  )
})

function DialogContent({
  className,
  children,
  overlayClassName,
  showCloseButton = true,
  layout = "default",
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  overlayClassName?: string
  showCloseButton?: boolean
  /** Stable viewport-bounded frame with DialogBody as its only scroll owner. */
  layout?: "default" | "bounded"
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={overlayClassName} />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-layout={layout}
        className={cn(
          "fixed top-1/2 left-1/2 z-[var(--z-dialog)] grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-lg border bg-popover p-4 text-sm text-popover-foreground shadow-lg duration-100 outline-none sm:max-w-sm data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          // Percentages use the fixed containing block; vh overflows under CSS UI zoom.
          layout === "bounded" && "@container/dialog flex h-[min(42rem,calc(100%-2rem))] min-h-0 w-[calc(100%-2rem)] min-w-0 max-w-[38rem] flex-col overflow-hidden sm:max-w-[38rem] [&>[data-slot=dialog-header]]:shrink-0 [&>[data-slot=dialog-footer]]:shrink-0",
          className
        )}
        {...props}
      >
        <OverlayLayerProvider value="dialog-popover">{children}</OverlayLayerProvider>
        {showCloseButton && (
          <DialogPrimitive.Close data-slot="dialog-close" asChild>
            <Button
              variant="ghost"
              className="absolute top-2 right-2"
              size="icon-sm"
            >
              <XIcon
              />
              <span className="sr-only">Close</span>
            </Button>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogBody({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="dialog-body"
    className={cn("min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [overflow-anchor:none] [scrollbar-gutter:stable]", className)}
    {...props} />
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "-mx-4 -mb-4 flex flex-col-reverse gap-2 rounded-b-xl border-t bg-muted/50 p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn(
        "font-heading text-base leading-none font-medium",
        className
      )}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground *:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogBody,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
