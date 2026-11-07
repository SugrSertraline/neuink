import * as React from "react"

import { cn } from "@/lib/utils"

/** A determinate circular indicator. The arc inherits `currentColor`, so callers express the
 *  state colour with a text class instead of a second colour prop. */
function ProgressRing({
  className,
  size = 28,
  strokeWidth = 3,
  value,
  ...props
}: Omit<React.ComponentProps<"svg">, "children"> & {
  size?: number
  strokeWidth?: number
  /** 0–1. Values outside the range are clamped, so a raw ratio may be passed directly. */
  value: number
}) {
  const center = size / 2
  const radius = Math.max(0, center - strokeWidth / 2)
  const circumference = 2 * Math.PI * radius
  const progress = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
  return (
    <svg
      aria-hidden="true"
      className={cn("block shrink-0", className)}
      data-slot="progress-ring"
      fill="none"
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      {...props}
    >
      <circle
        className="stroke-current opacity-25"
        cx={center}
        cy={center}
        r={radius}
        strokeWidth={strokeWidth}
      />
      <circle
        className="stroke-current motion-safe:transition-[stroke-dashoffset] motion-safe:duration-150"
        cx={center}
        cy={center}
        r={radius}
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - progress)}
        strokeLinecap="round"
        strokeWidth={strokeWidth}
        transform={`rotate(-90 ${center} ${center})`}
      />
    </svg>
  )
}

export { ProgressRing }
