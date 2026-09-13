import { ChevronDown, ChevronUp } from "lucide-react"
import * as React from "react"

import { cn } from "./lib/utils"

/**
 * NumberInput v2.3 redesign:
 *  - Stepper column widened to w-8 (32 px) — from w-10 (40 px) which was
 *    shared with the suffix; now the steppers get dedicated space, both
 *    buttons are equal-height, and the click target is more comfortable.
 *  - Invalid value: input text colour flips to `text-bear` so the user sees
 *    at a glance which field has a bad value — no tooltip needed.
 *  - Focus-within glow matches Input v2.2 (ring-3 + ring-ring/50).
 *  - `suffix` ReactNode still supported — renders between the text field and
 *    the steppers, separated by border-border-subtle.
 *  - `size="sm"` supports dense data tables; `showSteppers={false}` hides the
 *    stepper column without page-level DOM selectors.
 */

type NumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type" | "onChange" | "size"
> & {
  value: string | number | undefined
  onValueChange: (value: string) => void
  step?: number
  min?: number
  max?: number
  suffix?: React.ReactNode
  invalid?: boolean
  size?: "sm" | "default"
  showSteppers?: boolean
  incrementLabel?: string
  decrementLabel?: string
}

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  (
    {
      className,
      value,
      onValueChange,
      step = 1,
      min,
      max,
      suffix,
      disabled,
      invalid = false,
      size = "default",
      showSteppers = true,
      incrementLabel = "增加",
      decrementLabel = "减少",
      onBlur,
      onFocus,
      ...props
    },
    ref,
  ) => {
    const [draftValue, setDraftValue] = React.useState(
      value === null || value === undefined ? "" : String(value),
    )
    const [isFocused, setIsFocused] = React.useState(false)

    React.useEffect(() => {
      if (!isFocused) {
        setDraftValue(value === null || value === undefined ? "" : String(value))
      }
    }, [isFocused, value])

    const normalize = (next: number) => {
      if (typeof min === "number" && next < min) return min
      if (typeof max === "number" && next > max) return max
      return next
    }

    const shift = (direction: 1 | -1) => {
      const current = Number(draftValue || value || 0)
      const next = normalize(current + step * direction)
      const nextStr = String(Number(next.toFixed(10)))
      setDraftValue(nextStr)
      onValueChange(nextStr)
    }

    return (
      <div
        data-slot="number-input"
        data-invalid={invalid || undefined}
        data-size={size}
        className={cn(
          "flex h-9 w-full overflow-hidden rounded-lg border border-input bg-card",
          "data-[size=sm]:h-8 data-[size=sm]:rounded-md",
          "transition-[border-color,background-color,box-shadow] duration-fast ease-out",
          "hover:border-ring",
          "focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50",
          // Invalid wrapper border
          "data-[invalid=true]:border-destructive data-[invalid=true]:focus-within:ring-destructive/20",
          disabled && "opacity-50 saturate-50",
          className,
        )}
      >
        {/* Text field */}
        <input
          ref={ref}
          type="text"
          inputMode="decimal"
          value={draftValue}
          disabled={disabled}
          onFocus={(e) => { setIsFocused(true); onFocus?.(e) }}
          onBlur={(e) => {
            setIsFocused(false)
            setDraftValue(value === null || value === undefined ? "" : String(value))
            onBlur?.(e)
          }}
          onChange={(e) => {
            setDraftValue(e.target.value)
            onValueChange(e.target.value)
          }}
          className={cn(
            "min-w-0 flex-1 bg-transparent px-3 py-2 text-sm tabular-nums text-foreground",
            "outline-none placeholder:text-foreground-tertiary",
            "disabled:cursor-not-allowed",
            size === "sm" && "px-2 py-1 text-xs",
            // Invalid: text colour flips to bear
            invalid && "text-bear",
          )}
          {...props}
        />

        {/* Optional suffix label (e.g. "USDT") */}
        {suffix && (
          <div className="flex shrink-0 items-center border-l border-border-subtle px-3 text-xs font-semibold text-foreground-tertiary bg-muted">
            {suffix}
          </div>
        )}

        {/* Steppers — widened to w-8 */}
        {showSteppers && (
          <div
            className={cn(
              "grid w-8 shrink-0 grid-rows-2 border-l border-border-subtle",
              size === "sm" && "w-7",
            )}
          >
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label={incrementLabel}
              onClick={() => shift(1)}
              className={cn(
                "flex cursor-pointer items-center justify-center",
                "text-foreground-tertiary",
                "transition-colors duration-fast ease-out",
                "hover:bg-muted hover:text-foreground active:bg-accent",
                "disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-foreground-tertiary",
              )}
            >
              <ChevronUp className="size-3.5" />
            </button>
            <button
              type="button"
              tabIndex={-1}
              disabled={disabled}
              aria-label={decrementLabel}
              onClick={() => shift(-1)}
              className={cn(
                "flex cursor-pointer items-center justify-center border-t border-border-subtle",
                "text-foreground-tertiary",
                "transition-colors duration-fast ease-out",
                "hover:bg-muted hover:text-foreground active:bg-accent",
                "disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-foreground-tertiary",
              )}
            >
              <ChevronDown className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    )
  },
)
NumberInput.displayName = "NumberInput"

export { NumberInput }
