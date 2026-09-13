import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./lib/utils"

/**
 * Alert v2.2 redesign:
 *  - All coloured variants get a 3 px left accent bar (absolutely-positioned
 *    div, not ::before pseudo, so it works without extra CSS).
 *  - Icon colour is now driven by `text-current` so it inherits the variant
 *    colour automatically — no more muted-foreground grey breaking the mood.
 *  - Container padding-left increased to pl-10 to clear the bar + icon.
 *  - description colour matches the variant foreground at 80% opacity.
 */

const alertVariants = cva(
  [
    "group/alert relative w-full overflow-hidden rounded-lg border",
    "pl-10 pr-4 py-3 text-left text-sm",
    "has-data-[slot=alert-action]:pr-18",
    "has-[>svg]:grid has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-2",
    "*:[svg]:row-span-2 *:[svg]:translate-y-0.5 *:[svg]:size-4 *:[svg]:shrink-0 *:[svg]:text-current",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-card text-card-foreground",
        destructive:
          "bg-destructive/[0.06] border-destructive/20 text-destructive dark:bg-destructive/10 dark:border-destructive/30",
        info:
          "bg-info-bg border-info/25 text-info",
        warning:
          "bg-warning-bg border-warning/25 text-warning-fg",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

const accentBarVariants = cva(
  "absolute inset-y-0 left-0 w-[3px] rounded-l-lg",
  {
    variants: {
      variant: {
        default:     "bg-border",
        destructive: "bg-destructive",
        info:        "bg-info",
        warning:     "bg-warning",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    >
      {/* Left accent bar */}
      <span
        aria-hidden="true"
        className={accentBarVariants({ variant })}
      />
      {props.children}
    </div>
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-semibold leading-snug",
        "group-has-[>svg]/alert:col-start-2",
        "[&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-brand-text",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn(
        "text-sm/relaxed text-balance opacity-80",
        "group-has-[>svg]/alert:col-start-2",
        "[&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:opacity-100",
        "[&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-2 right-2", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
