import { Slot } from "@radix-ui/react-slot"
import { cva } from "class-variance-authority"
import * as React from "react"

import { cn } from "./lib/utils"

/**
 * InfoBlock v2.2 redesign:
 *  - Left 3 px accent bar (absolutely-positioned div) mirrors Alert redesign
 *    so the two components feel visually related.
 *  - Dedicated `icon` slot: pass any ReactNode as `icon` prop; it renders in
 *    the fixed 16 px × 16 px well left of the content.
 *  - padding-left grows to pl-10 to clear both bar and icon.
 *  - Density sm/md controls overall padding as before.
 */

type InfoBlockVariant = "default" | "info" | "warning" | "success" | "error"

const infoBlockVariants = cva(
  "relative overflow-hidden rounded-md text-sm",
  {
    variants: {
      variant: {
        default: "bg-muted text-muted-foreground border border-border-subtle",
        info:    "bg-info-bg text-info border border-info/20",
        warning: "bg-warning-bg text-warning-fg border border-warning/20",
        success: "bg-bull-bg text-bull border border-bull/20",
        error:   "bg-destructive/[0.07] text-destructive border border-destructive/18",
      },
      density: {
        sm: "py-2.5 pr-3 pl-10",
        md: "py-3 pr-4 pl-10",
      },
    },
    defaultVariants: {
      variant: "default",
      density: "sm",
    },
  }
)

const accentBarVariants = cva(
  "absolute inset-y-0 left-0 w-[3px] rounded-l-md",
  {
    variants: {
      variant: {
        default: "bg-border",
        info:    "bg-info",
        warning: "bg-warning",
        success: "bg-bull",
        error:   "bg-destructive",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

type InfoBlockProps = React.HTMLAttributes<HTMLElement> & {
  density?: "sm" | "md"
  asChild?: boolean
  variant?: InfoBlockVariant | string
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
  /** Optional icon rendered in the fixed left well. Any ReactNode (SVG, img). */
  icon?: React.ReactNode
}

function isInfoBlockVariant(v: string): v is InfoBlockVariant {
  return ["default", "info", "warning", "success", "error"].includes(v)
}

function InfoBlock({
  density = "sm",
  variant = "default",
  asChild = false,
  className,
  title,
  description,
  action,
  icon,
  children,
  ...props
}: InfoBlockProps) {
  const resolvedVariant = isInfoBlockVariant(variant) ? variant : "default"
  const blockClassName = cn(infoBlockVariants({ variant: resolvedVariant, density }), className)

  if (asChild) {
    return (
      <Slot
        data-slot="info-block"
        data-variant={variant}
        className={blockClassName}
        {...props}
      >
        {children}
      </Slot>
    )
  }

  return (
    <div
      data-slot="info-block"
      data-variant={variant}
      className={blockClassName}
      {...props}
    >
      {/* Left accent bar */}
      <span aria-hidden="true" className={accentBarVariants({ variant: resolvedVariant })} />

      {/* Icon well — always 16 × 16, top-aligned */}
      {icon && (
        <span
          aria-hidden="true"
          data-slot="info-block-icon"
          className="absolute left-2.5 top-[calc(var(--spacing)*2.5+1px)] flex size-4 shrink-0 items-center justify-center [&>svg]:size-4"
        >
          {icon}
        </span>
      )}

      {title || description || action ? (
        <div data-slot="info-block-content" className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <div data-slot="info-block-title" className="font-semibold text-current">
                {title}
              </div>
            )}
            {description && (
              <div data-slot="info-block-description" className="mt-0.5 text-xs text-current/80">
                {description}
              </div>
            )}
          </div>
          {action && <div data-slot="info-block-action">{action}</div>}
        </div>
      ) : (
        children
      )}
    </div>
  )
}

export { InfoBlock }
