import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Badge v2.2 redesign:
 *  - NEW `bull-solid` / `bear-solid`: solid filled variants for high-emphasis
 *    financial status (large price moves, critical states). Uses
 *    `text-foreground-inverse` (white light / black dark) for AA contrast.
 *  - NEW `dot` boolean prop: prepends a 5px current-color circle — useful for
 *    "status running/paused" patterns without requiring a separate icon.
 *  - All existing variants unchanged.
 */
const badgeVariants = cva(
  [
    "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1",
    "overflow-hidden rounded-full border border-transparent",
    "px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
    "transition-colors duration-fast ease-out",
    "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
    "aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
    "[&>svg]:pointer-events-none [&>svg]:size-3!",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-brand-muted text-brand-text [a]:hover:bg-brand-muted/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link:
          "text-brand-text underline-offset-4 hover:underline",
        bull:
          "bg-bull-bg text-bull [a]:hover:bg-bull-bg/80",
        bear:
          "bg-bear-bg text-bear [a]:hover:bg-bear-bg/80",
        warning:
          "bg-warning-bg text-warning-fg [a]:hover:bg-warning-bg/80",
        info:
          "bg-info-bg text-info [a]:hover:bg-info-bg/80",
        // ── NEW: high-emphasis solid variants ──────────────────────────────
        "bull-solid":
          "bg-bull text-foreground-inverse border-transparent",
        "bear-solid":
          "bg-bear text-foreground-inverse border-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends useRender.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {
  /** Prepend a 5 px status dot (current-color circle) before children. */
  dot?: boolean
}

function Badge({
  className,
  variant = "default",
  dot = false,
  render,
  children,
  ...props
}: BadgeProps) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
        children,
      },
      props
    ),
    render,
    state: { slot: "badge", variant },
  }) as unknown as React.ReactElement
}

// Internal wrapper that injects the dot — we re-render via a thin wrapper
// so the hook-based `Badge` stays untouched.
function BadgeWithDot({
  dot,
  children,
  ...props
}: BadgeProps & { children?: React.ReactNode }) {
  return (
    <Badge {...props}>
      {dot && (
        <span
          aria-hidden="true"
          className="size-[5px] shrink-0 rounded-full bg-current"
        />
      )}
      {children}
    </Badge>
  )
}

// Export the dot-aware version as the default Badge
const BadgeExport = ({ dot, children, ...props }: BadgeProps & { children?: React.ReactNode }) =>
  dot ? <BadgeWithDot dot={dot} {...props}>{children}</BadgeWithDot>
       : <Badge {...props}>{children}</Badge>

BadgeExport.displayName = "Badge"

export { BadgeExport as Badge, badgeVariants }
