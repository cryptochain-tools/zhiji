import { Info } from "lucide-react"
import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Section v2.2 redesign:
 *  - Count badge uses `tabular-nums` (was missing) so digit widths are stable.
 *  - `countTone="brand"` now uses `text-brand-text` (AA on brand-muted bg)
 *    instead of the old `text-brand` which had insufficient contrast.
 *  - Loading state: replaced raw text with a Spinner + label for visual parity
 *    with other loading patterns in the system.
 *  - Description tooltip icon has an explicit `aria-label` for accessibility.
 *  - NEW `action` prop: optional ReactNode rendered right of the count — for
 *    section-level CTA buttons ("+ 新建策略" etc).
 */

type SectionProps = React.HTMLAttributes<HTMLElement> & {
  title: string
  description?: string
  count?: number
  countTone?: "default" | "brand"
  loading?: boolean
  loadingText?: string
  /** Optional right-hand action (e.g. a Button) placed after the count. */
  action?: React.ReactNode
}

const countToneClassMap = {
  default: "bg-muted text-foreground-tertiary",
  brand:   "bg-brand-muted text-brand-text",
} as const

const Section = ({
  title,
  description,
  count,
  countTone = "default",
  loading = false,
  loadingText = "加载中…",
  action,
  className,
  children,
  ...props
}: SectionProps) => (
  <section data-slot="section" className={cn("min-w-0", className)} {...props}>
    <div
      data-slot="section-header"
      className="mb-3 flex items-center justify-between gap-3"
    >
      {/* Left: title + optional description tooltip */}
      <div data-slot="section-title-row" className="flex min-w-0 items-center gap-2">
        <h2
          data-slot="section-title"
          className="text-h3 font-semibold text-foreground"
        >
          {title}
        </h2>

        {description && (
          <button
            type="button"
            title={description}
            aria-label={description}
            className={cn(
              "inline-flex size-5 cursor-help items-center justify-center rounded-full",
              "text-foreground-tertiary",
              "transition-colors duration-fast ease-out",
              "hover:bg-muted hover:text-foreground",
            )}
          >
            <Info className="size-3.5" />
          </button>
        )}
      </div>

      {/* Right: count badge + optional action */}
      <div className="flex shrink-0 items-center gap-2">
        {typeof count === "number" && (
          <span
            data-slot="section-count"
            data-tone={countTone}
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
              countToneClassMap[countTone],
            )}
          >
            {count}
          </span>
        )}

        {action}
      </div>
    </div>

    {loading ? (
      <div
        data-slot="section-loading"
        className="flex items-center justify-center gap-2 py-6 text-sm text-foreground-tertiary"
      >
        {/* Inline ring spinner — avoids importing Spinner to keep the dep lightweight */}
        <span
          aria-hidden="true"
          className="inline-block size-4 rounded-full border-2 border-border border-t-foreground-tertiary animate-spin"
        />
        {loadingText}
      </div>
    ) : (
      children
    )}
  </section>
)

Section.displayName = "Section"

export { Section }
