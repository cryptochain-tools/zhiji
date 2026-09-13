"use client"

import { Progress as ProgressPrimitive } from "@base-ui/react/progress"

import { cn } from "./lib/utils"

/**
 * Progress v2.2 redesign:
 *  - NEW `size` prop: "xs" (2 px) | "sm" (4 px) | "default" (6 px) | "lg" (8 px).
 *  - NEW `indeterminate` tone: animated diagonal-stripe fill for unknown
 *    duration tasks. Requires `animate-progress-stripes` from globals-additions.css.
 *  - NEW `gradient` tone: brand → info gradient for primary KPI bars.
 *  - Existing `brand` | `bull` | `bear` | `warning` tones unchanged.
 *  - `complete` / `total` convenience props still supported.
 */

type ProgressSize = "xs" | "sm" | "default" | "lg"

const trackHeightMap: Record<ProgressSize, string> = {
  xs:      "h-[2px]",
  sm:      "h-1",
  default: "h-1.5",
  lg:      "h-2",
}

function Progress({
  className,
  children,
  value,
  complete,
  total,
  tone,
  size = "default",
  ...props
}: Omit<ProgressPrimitive.Root.Props, "value"> & {
  value?: number
  complete?: number
  total?: number
  size?: ProgressSize
  tone?: "brand" | "gradient" | "bull" | "bear" | "warning" | "indeterminate" | string
}) {
  const resolvedValue =
    value ??
    (typeof complete === "number" && typeof total === "number" && total > 0
      ? (complete / total) * 100
      : undefined)

  return (
    <ProgressPrimitive.Root
      value={tone === "indeterminate" ? null : (resolvedValue ?? null)}
      data-slot="progress"
      data-tone={tone}
      data-size={size}
      className={cn("group/progress flex flex-wrap gap-3", className)}
      {...props}
    >
      {children}
      <ProgressTrack size={size}>
        <ProgressIndicator tone={tone} />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  )
}

function ProgressTrack({
  className,
  size = "default",
  ...props
}: ProgressPrimitive.Track.Props & { size?: ProgressSize }) {
  return (
    <ProgressPrimitive.Track
      data-slot="progress-track"
      className={cn(
        "relative flex w-full items-center overflow-x-hidden rounded-full bg-muted",
        trackHeightMap[size],
        className
      )}
      {...props}
    />
  )
}

function ProgressIndicator({
  className,
  tone,
  ...props
}: ProgressPrimitive.Indicator.Props & { tone?: string }) {
  return (
    <ProgressPrimitive.Indicator
      data-slot="progress-indicator"
      className={cn(
        "h-full rounded-full transition-[width,background-color] duration-base ease-out",
        // Default brand fill
        "bg-primary",
        // Gradient override
        "group-data-[tone=gradient]/progress:bg-gradient-brand",
        // Financial tones
        "group-data-[tone=bull]/progress:bg-bull",
        "group-data-[tone=bear]/progress:bg-bear",
        "group-data-[tone=warning]/progress:bg-warning",
        // Indeterminate — stripe animation; width is fixed at 38% via data-null
        "group-data-[tone=indeterminate]/progress:w-[38%]",
        "group-data-[tone=indeterminate]/progress:animate-progress-stripes",
        "group-data-[tone=indeterminate]/progress:[background-image:repeating-linear-gradient(-45deg,var(--brand)_0,var(--brand)_6px,var(--brand-hover)_6px,var(--brand-hover)_12px)]",
        "group-data-[tone=indeterminate]/progress:[background-size:24px_100%]",
        className
      )}
      {...props}
    />
  )
}

function ProgressLabel({ className, ...props }: ProgressPrimitive.Label.Props) {
  return (
    <ProgressPrimitive.Label
      data-slot="progress-label"
      className={cn("text-sm font-medium", className)}
      {...props}
    />
  )
}

function ProgressValue({ className, ...props }: ProgressPrimitive.Value.Props) {
  return (
    <ProgressPrimitive.Value
      data-slot="progress-value"
      className={cn("ml-auto text-sm text-muted-foreground tabular-nums", className)}
      {...props}
    />
  )
}

export { Progress, ProgressTrack, ProgressIndicator, ProgressLabel, ProgressValue }
