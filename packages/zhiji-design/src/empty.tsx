import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./lib/utils"

/**
 * Empty v2.2 redesign:
 *  - EmptyMedia `ring` variant: replaces the plain square icon container with
 *    a 48 px circle that has a visible border + muted fill — gives the icon
 *    visual breathing room without a coloured background.
 *  - Dashed border on the root is now `border-border` (slightly more visible)
 *    rather than the previous default colour.
 *  - `card` variant uses solid border + bg-card (unchanged from v2.1).
 */

function Empty({
  className,
  variant,
  title,
  description,
  action,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  variant?: "default" | "card"
  title?: React.ReactNode
  description?: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <div
      data-slot="empty"
      data-variant={variant}
      className={cn(
        "flex w-full min-w-0 flex-1 flex-col items-center justify-center gap-4 rounded-xl border-dashed border-border p-6 text-center text-balance",
        variant === "card" && "rounded-lg border-solid bg-card shadow-card",
        className
      )}
      {...props}
    >
      {title || description || action ? (
        <>
          <EmptyHeader>
            {title && <EmptyTitle>{title}</EmptyTitle>}
            {description && <EmptyDescription>{description}</EmptyDescription>}
          </EmptyHeader>
          {action && <EmptyContent>{action}</EmptyContent>}
        </>
      ) : (
        children
      )}
    </div>
  )
}

function EmptyHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-header"
      className={cn("flex max-w-sm flex-col items-center gap-2", className)}
      {...props}
    />
  )
}

const emptyMediaVariants = cva(
  "mb-2 flex shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        /** No container — renders children directly */
        default: "bg-transparent",
        /** Square muted bg chip (legacy) */
        icon: "flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground [&_svg:not([class*='size-'])]:size-4",
        /**
         * NEW: circular ring container — border + muted fill.
         * Recommended for most empty state illustrations.
         */
        ring: "flex size-12 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-foreground-tertiary [&_svg:not([class*='size-'])]:size-5",
      },
    },
    defaultVariants: {
      variant: "ring",
    },
  }
)

function EmptyMedia({
  className,
  variant = "ring",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof emptyMediaVariants>) {
  return (
    <div
      data-slot="empty-icon"
      data-variant={variant}
      className={cn(emptyMediaVariants({ variant, className }))}
      {...props}
    />
  )
}

function EmptyTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-title"
      className={cn("font-heading text-h3 font-semibold tracking-tight", className)}
      {...props}
    />
  )
}

function EmptyDescription({ className, ...props }: React.ComponentProps<"p">) {
  return (
    <div
      data-slot="empty-description"
      className={cn(
        "text-sm/relaxed text-muted-foreground",
        "[&>a]:underline [&>a]:underline-offset-4 [&>a:hover]:text-brand-text",
        className
      )}
      {...props}
    />
  )
}

function EmptyContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="empty-content"
      className={cn(
        "flex w-full max-w-sm min-w-0 flex-col items-center gap-2.5 text-sm text-balance",
        className
      )}
      {...props}
    />
  )
}

export { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyContent, EmptyMedia }
