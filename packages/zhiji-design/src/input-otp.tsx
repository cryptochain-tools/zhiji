import * as React from "react"
import { OTPInput, OTPInputContext } from "input-otp"
import { MinusIcon } from "lucide-react"

import { cn } from "./lib/utils"

/**
 * InputOTP v2.2 redesign:
 *  - Each slot becomes an independent rounded card (10 px radius), not a
 *    shared-border connected pill. Cleaner, more modern feel.
 *  - Slot dimensions: 44 × 52 px (was 32 × 32).
 *  - Active slot: brand ring (3 px) + brand border.
 *  - Invalid: destructive border + soft red ring on the group.
 *  - Separator (MinusIcon) sized at 16 px for legibility.
 */

function InputOTP({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<typeof OTPInput> & {
  containerClassName?: string
}) {
  return (
    <OTPInput
      data-slot="input-otp"
      containerClassName={cn(
        "cn-input-otp flex items-center gap-2 has-disabled:opacity-50",
        containerClassName
      )}
      spellCheck={false}
      className={cn("disabled:cursor-not-allowed", className)}
      {...props}
    />
  )
}

function InputOTPGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-group"
      className={cn(
        "flex items-center gap-2",
        "has-aria-invalid:[&_[data-slot=input-otp-slot]]:border-destructive",
        "has-aria-invalid:[&_[data-slot=input-otp-slot]]:ring-destructive/20",
        "dark:has-aria-invalid:[&_[data-slot=input-otp-slot]]:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

function InputOTPSlot({
  index,
  className,
  ...props
}: React.ComponentProps<"div"> & { index: number }) {
  const inputOTPContext = React.useContext(OTPInputContext)
  const { char, hasFakeCaret, isActive } = inputOTPContext?.slots[index] ?? {}

  return (
    <div
      data-slot="input-otp-slot"
      data-active={isActive}
      className={cn(
        "relative flex h-12 w-11 items-center justify-center rounded-lg",
        "border-[1.5px] border-input bg-card",
        "text-xl font-semibold tabular-nums text-foreground",
        "transition-all duration-fast ease-out outline-none",
        // Active state — brand ring
        "data-[active=true]:z-10 data-[active=true]:border-brand data-[active=true]:ring-3 data-[active=true]:ring-ring/50",
        // Invalid
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "data-[active=true]:aria-invalid:border-destructive",
        "dark:bg-input/30",
        className
      )}
      {...props}
    >
      {char}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-5 w-px animate-caret-blink bg-foreground duration-1000" />
        </div>
      )}
    </div>
  )
}

function InputOTPSeparator({ ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-otp-separator"
      className="flex items-center text-foreground-tertiary [&_svg:not([class*='size-'])]:size-4"
      role="separator"
      {...props}
    >
      <MinusIcon />
    </div>
  )
}

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
