import * as React from "react"

import { cn } from "./lib/utils"

/**
 * StatItem v2.2 redesign:
 *  - NEW `StatDelta` sub-component: renders a bull/bear/neutral trend badge
 *    inline below the value — replaces ad-hoc badge usage in consumers.
 *  - NEW `StatCard` wrapper: self-contained card surface (border + shadow)
 *    for dashboard grid usage. Accepts the same props as StatItem plus
 *    optional `footer` ReactNode.
 *  - All existing StatItem props unchanged.
 */

type Tone = "default" | "brand" | "bull" | "bear" | "warning"
type Size = "sm" | "md" | "lg"

const toneClassMap: Record<Tone, string> = {
  default: "text-foreground",
  brand:   "text-brand-text",
  bull:    "text-bull",
  bear:    "text-bear",
  warning: "text-warning-fg",
} as const

const valueSizeClassMap: Record<Size, string> = {
  sm: "text-xs",
  md: "text-sm",
  lg: "text-stat-lg leading-tight",
} as const

// ── StatItem ──────────────────────────────────────────────────────────────────

type StatItemProps = {
  label: string
  value: React.ReactNode
  tone?: Tone
  size?: Size
  helper?: React.ReactNode
  className?: string
}

function StatItem({
  label,
  value,
  tone = "default",
  size = "md",
  helper,
  className,
}: StatItemProps) {
  return (
    <div data-slot="stat-item" className={cn("flex flex-col gap-1", size === "lg" && "gap-2", className)}>
      <span data-slot="stat-item-label" className="text-xs text-foreground-tertiary font-medium">
        {label}
      </span>
      <span
        data-slot="stat-item-value"
        className={cn("font-semibold tabular-nums", valueSizeClassMap[size], toneClassMap[tone])}
      >
        {value}
      </span>
      {helper && (
        <span data-slot="stat-item-helper" className="text-xs text-muted-foreground">
          {helper}
        </span>
      )}
    </div>
  )
}

// ── StatDelta ─────────────────────────────────────────────────────────────────

type DeltaTone = "bull" | "bear" | "neutral"

const deltaToneMap: Record<DeltaTone, string> = {
  bull:    "bg-bull-bg text-bull",
  bear:    "bg-bear-bg text-bear",
  neutral: "bg-muted text-foreground-tertiary",
}

type StatDeltaProps = {
  value: React.ReactNode
  tone?: DeltaTone
  className?: string
}

/**
 * StatDelta — compact trend badge rendered below a stat value.
 *
 * ```tsx
 * <StatItem label="收益率" value="+12.4%" tone="brand" size="lg">
 *   <StatDelta value="↑ +2.4% 今日" tone="bull" />
 * </StatItem>
 * ```
 */
function StatDelta({ value, tone = "neutral", className }: StatDeltaProps) {
  return (
    <span
      data-slot="stat-delta"
      className={cn(
        "inline-flex w-fit items-center gap-1 rounded-md px-2 py-0.5",
        "text-xs font-semibold tabular-nums",
        deltaToneMap[tone],
        className
      )}
    >
      {value}
    </span>
  )
}

// ── StatCard ──────────────────────────────────────────────────────────────────

type StatCardProps = StatItemProps & {
  delta?: React.ReactNode
  deltaTone?: DeltaTone
  footer?: React.ReactNode
}

/**
 * StatCard — self-contained card surface for dashboard grids.
 * Combines StatItem + StatDelta inside a bordered card.
 *
 * ```tsx
 * <StatCard
 *   label="累计成交"
 *   value="$1.2M"
 *   size="lg"
 *   delta="↑ +3 本周"
 *   deltaTone="bull"
 * />
 * ```
 */
function StatCard({
  label,
  value,
  tone = "default",
  size = "lg",
  helper,
  delta,
  deltaTone = "neutral",
  footer,
  className,
}: StatCardProps) {
  return (
    <div
      data-slot="stat-card"
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-border-subtle bg-card p-4 shadow-card",
        className
      )}
    >
      <StatItem label={label} value={value} tone={tone} size={size} helper={helper} />
      {delta && <StatDelta value={delta} tone={deltaTone} />}
      {footer && (
        <div data-slot="stat-card-footer" className="mt-1 text-xs text-muted-foreground">
          {footer}
        </div>
      )}
    </div>
  )
}

export { StatItem, StatDelta, StatCard }
