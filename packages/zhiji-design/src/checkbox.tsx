"use client"

import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox"

import { cn } from "./lib/utils"
import { CheckIcon, MinusIcon } from "lucide-react"

/**
 * Checkbox v2.2 redesign:
 *  - NEW `indeterminate` boolean prop: renders a MinusIcon instead of
 *    CheckIcon — used when a "select all" control has a partial selection.
 *    Sets `aria-checked="mixed"` on the underlying primitive.
 *  - All existing styling unchanged.
 */

function Checkbox({
  className,
  indeterminate = false,
  ...props
}: CheckboxPrimitive.Root.Props & {
  /** Render the minus/dash indicator for partial-selection state. */
  indeterminate?: boolean
}) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      aria-checked={indeterminate ? "mixed" : undefined}
      className={cn(
        "peer relative flex size-4 shrink-0 items-center justify-center rounded-[4px]",
        "border border-input bg-field",
        "transition-colors duration-fast ease-out outline-none",
        "group-has-disabled/field:opacity-50",
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // Checked state
        "data-checked:border-primary data-checked:bg-primary data-checked:text-primary-foreground dark:data-checked:bg-primary",
        // Indeterminate — treat visually same as checked
        indeterminate && "border-primary bg-primary text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="grid place-content-center text-current transition-none [&>svg]:size-3.5"
      >
        {indeterminate ? <MinusIcon /> : <CheckIcon />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
