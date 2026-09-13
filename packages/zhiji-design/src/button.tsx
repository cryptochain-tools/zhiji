import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "./lib/utils"
import { Spinner } from "./spinner"

/**
 * Button v2.2 redesign:
 *  - Loading state: uses <Spinner> and keeps primary buttons visually active
 *    while preventing duplicate clicks.
 *  - `brand` variant keeps gradient + shadow-brand for high-emphasis CTA.
 *  - `primary` alias removed (use `default`).
 *  - `xs` size retained for dense table rows / inline actions.
 *  - `lg` h-11 (44px) meets mobile hit-target spec.
 *  - `transition-colors duration-fast ease-out` (cheaper than transition-all).
 */
const buttonVariants = cva(
  [
    "group/button inline-flex shrink-0 items-center justify-center",
    "rounded-lg border border-transparent bg-clip-padding",
    "text-sm font-button whitespace-nowrap",
    "transition-colors duration-fast ease-out outline-none select-none",
    "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
    "active:not-aria-[haspopup]:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50",
    "data-[loading=true]:pointer-events-none data-[loading=true]:cursor-wait",
    "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
    "dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-brand-hover aria-expanded:bg-brand-hover",
        brand:
          "bg-gradient-brand text-primary-foreground shadow-brand hover:opacity-90",
        outline:
          "border-border bg-background text-foreground font-medium hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          // border-input: --secondary 与 --muted 完全同色(#f8fafc light / #1c1c1e dark),
          // 把 secondary 按钮放到 DialogFooter / 任何 bg-muted 表面上,按钮会"消失"在
          // 同色背景里(只剩文字)。加 border-input 让 secondary 在所有浅色面上都有
          // 可识别的按钮边线。
          "border-input bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "font-medium hover:bg-muted hover:text-foreground aria-expanded:bg-muted dark:hover:bg-muted/50",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link:
          "font-medium text-brand-text underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs:
          "h-7 gap-1 rounded-md px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm:
          "h-8 gap-1 rounded-md px-2.5 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg:
          "h-11 gap-1.5 rounded-lg px-5 text-base has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon:        "size-9 rounded-full",
        "icon-xs":   "size-7 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":   "size-8 rounded-md",
        "icon-lg":   "size-11 rounded-full",
        actionIcon:  "size-9 rounded-md p-0",
        link:        "h-auto gap-1 p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild,
  loading = false,
  disabled,
  children,
  onClick,
  ...props
}: ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
    children?: React.ReactNode
  }) {
  const child = asChild && React.isValidElement(children) ? children : undefined

  // Derive Spinner tone from variant so it always reads on the button surface
  const spinnerTone =
    variant === "outline" || variant === "ghost" || variant === "secondary" || variant === "link"
      ? "muted"
      : variant === "destructive"
        ? "destructive"
        : "inverse"

  const handleClick = React.useCallback<
    NonNullable<ButtonPrimitive.Props["onClick"]>
  >(
    (event) => {
      if (disabled || loading) {
        event.preventDefault()
        return
      }
      onClick?.(event)
    },
    [disabled, loading, onClick],
  )

  return (
    <ButtonPrimitive
      data-slot="button"
      data-loading={loading ? "true" : undefined}
      aria-busy={loading || undefined}
      aria-disabled={disabled || loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled}
      onClick={handleClick}
      render={child}
      {...props}
    >
      {loading && (
        <Spinner
          size="sm"
          tone={spinnerTone as "brand" | "muted" | "destructive" | "inverse"}
          aria-hidden="true"
        />
      )}
      {asChild ? undefined : children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
