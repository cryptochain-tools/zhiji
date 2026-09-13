import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Spinner v2.2 redesign:
 *  - Replaced Loader2Icon (equal-weight line icon) with a CSS dual-ring
 *    using border utilities — brand-color arc on a muted track.
 *  - Added size: sm (14px) | md (20px) | lg (28px).
 *  - Added tone: brand | muted | destructive | inverse.
 *  - Uses `animate-spin` (already available) + `duration-[700ms]` for
 *    a slightly slower, more premium feel.
 */

const spinnerVariants = cva(
  "inline-block shrink-0 rounded-full border-[2.5px] border-t-transparent animate-spin",
  {
    variants: {
      size: {
        sm: "size-3.5 border-2",
        md: "size-5",
        lg: "size-7 border-[3px]",
      },
      tone: {
        brand:       "border-brand/20 border-t-brand",
        muted:       "border-border border-t-foreground-tertiary",
        destructive: "border-destructive/20 border-t-destructive",
        inverse:     "border-primary-foreground/30 border-t-primary-foreground",
      },
    },
    defaultVariants: {
      size: "md",
      tone: "brand",
    },
  }
)

export interface SpinnerProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof spinnerVariants> {}

function Spinner({ className, size, tone, ...props }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label="Loading"
      data-slot="spinner"
      className={cn(spinnerVariants({ size, tone }), className)}
      {...props}
    />
  )
}

export { Spinner, spinnerVariants }
