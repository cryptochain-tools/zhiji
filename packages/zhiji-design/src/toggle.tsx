"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./lib/utils"

/**
 * Toggle v2.2 redesign:
 *  - Active (data-[state=on]) state: brand-muted bg + brand/40 ring border —
 *    the ring makes the active state clearly perceivable without an icon.
 *  - `font-semibold` on active for stronger typographic weight.
 *  - `panel` variant: card-like surface for toolbar / option-bar patterns.
 *  - `aria-pressed` mirrors `data-[state=on]` for screen-reader parity.
 */
const toggleVariants = cva(
  [
    "group/toggle inline-flex items-center justify-center gap-1",
    "rounded-lg text-sm font-medium whitespace-nowrap",
    "transition-[color,background-color,border-color,box-shadow] duration-fast ease-out outline-none",
    "hover:bg-muted hover:text-foreground",
    "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
    "disabled:pointer-events-none disabled:opacity-50",
    // Active state ─────────────────────────────────────────────────────────────
    "data-[state=on]:bg-brand-muted data-[state=on]:text-brand-text data-[state=on]:font-semibold",
    "data-[state=on]:shadow-[0_0_0_1px_color-mix(in_srgb,var(--brand)_40%,transparent)]",
    // aria-pressed mirrors data-[state=on]
    "aria-pressed:bg-brand-muted aria-pressed:text-brand-text aria-pressed:font-semibold",
    "aria-pressed:shadow-[0_0_0_1px_color-mix(in_srgb,var(--brand)_40%,transparent)]",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-transparent border border-transparent",
        outline: "border border-input bg-transparent hover:bg-muted",
        panel:
          "border border-border-subtle bg-card hover:bg-card-hover data-[state=on]:bg-accent",
      },
      size: {
        default:
          "h-8 min-w-8 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm:
          "h-7 min-w-7 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg:
          "h-9 min-w-9 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
