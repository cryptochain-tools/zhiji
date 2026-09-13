import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Card v2.2 redesign:
 *  - NEW `tone` prop: "brand" | "bull" | "bear" — adds a 3 px top accent
 *    border that signals the card's semantic role at a glance.
 *  - `interactive` mode now includes `hover:shadow-[0_8px_32px_rgba(0,0,0,.1)]`
 *    and `hover:-translate-y-px` for a clear lift effect.
 *  - `variant="card"` (the full shadow variant) gets `md:p-6` as before.
 *  - `variant="plain"` unchanged (borderless / transparent).
 *  - `size="sm"` gap/padding unchanged.
 *  - `CardTitle` uses `text-h2` for default, `text-h3` for sm.
 */

const toneTopBorderMap = {
  brand: "border-t-brand border-t-[3px] pt-[calc(theme(spacing.4)-3px)]",
  bull:  "border-t-bull  border-t-[3px] pt-[calc(theme(spacing.4)-3px)]",
  bear:  "border-t-bear  border-t-[3px] pt-[calc(theme(spacing.4)-3px)]",
} as const

type CardTone = keyof typeof toneTopBorderMap

function Card({
  className,
  size = "default",
  variant = "default",
  tone,
  interactive,
  ...props
}: React.ComponentProps<"div"> & {
  size?: "default" | "sm"
  variant?: "default" | "plain" | "card"
  tone?: CardTone
  interactive?: boolean
}) {
  return (
    <div
      data-slot="card"
      data-size={size}
      data-variant={variant}
      data-interactive={interactive}
      className={cn(
        // Base
        "group/card flex flex-col gap-4 overflow-hidden rounded-xl border border-border-subtle bg-card p-4 text-sm text-card-foreground",
        // Footer / image edge-cases
        "has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0",
        "*:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl",
        // Size sm
        "data-[size=sm]:gap-3 data-[size=sm]:p-3 data-[size=sm]:has-data-[slot=card-footer]:pb-0",
        // Plain variant
        variant === "plain" && "gap-0 rounded-none border-0 bg-transparent p-0",
        // Card variant — full shadow
        variant === "card" && "rounded-lg bg-card shadow-card md:p-6",
        // Top tone border
        tone && toneTopBorderMap[tone],
        // Interactive
        interactive && [
          "cursor-pointer",
          "transition-[background-color,box-shadow,transform] duration-fast ease-out",
          "hover:bg-card-hover hover:shadow-[0_8px_32px_rgba(0,0,0,.1)] hover:-translate-y-px",
        ],
        className
      )}
      {...props}
    />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      className={cn(
        "group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl",
        "has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        "has-data-[slot=card-description]:grid-rows-[auto_auto]",
        "[.border-b]:pb-4 group-data-[size=sm]/card:[.border-b]:pb-3",
        className
      )}
      {...props}
    />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      className={cn(
        "font-heading text-h2 leading-snug font-semibold group-data-[size=sm]/card:text-h3",
        className
      )}
      {...props}
    />
  )
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)}
      {...props}
    />
  )
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-content" className={cn(className)} {...props} />
  )
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      className={cn(
        "flex items-center rounded-b-xl border-t border-border-subtle bg-muted/50",
        "-mx-4 px-4 pt-4 pb-4",
        "group-data-[size=sm]/card:-mx-3 group-data-[size=sm]/card:px-3 group-data-[size=sm]/card:pt-3 group-data-[size=sm]/card:pb-3",
        className
      )}
      {...props}
    />
  )
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
