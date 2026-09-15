import * as React from "react"

import { cn } from "@/lib/utils"

// Pinned cells inherit their row's opaque background, including hover/selection.
const pinnedCellClasses = {
  left: "sticky left-0 z-10 bg-inherit shadow-[4px_0_12px_-6px_color-mix(in_oklab,var(--foreground)_12%,transparent)] after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-border",
  right: "sticky right-0 z-10 bg-inherit shadow-[-4px_0_12px_-6px_color-mix(in_oklab,var(--foreground)_12%,transparent)] after:pointer-events-none after:absolute after:inset-y-0 after:left-0 after:w-px after:bg-border",
}

type TableCellPin = keyof typeof pinnedCellClasses

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, pin, ...props }: React.ComponentProps<"th"> & { pin?: TableCellPin }) {
  return (
    <th
      data-slot="table-head"
      data-pinned={pin}
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0",
        pin && pinnedCellClasses[pin],
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, pin, ...props }: React.ComponentProps<"td"> & { pin?: TableCellPin }) {
  return (
    <td
      data-slot="table-cell"
      data-pinned={pin}
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0",
        pin && pinnedCellClasses[pin],
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
