import * as React from "react"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "./lib/utils"

/**
 * NativeSelect v2.2 redesign:
 *  - Background: `bg-field` → `bg-card` (white, consistent with Input v2.2).
 *  - Default size: h-9 (was h-8) — aligns with Input and Select Trigger.
 *  - Focus glow: same as Input — `ring-3 ring-ring/50 + border-ring`.
 *  - Icon is `text-foreground-tertiary` (was `text-muted-foreground`).
 */

type NativeSelectProps = Omit<React.ComponentProps<"select">, "size"> & {
  size?: "sm" | "default"
}

function NativeSelect({ className, size = "default", ...props }: NativeSelectProps) {
  return (
    <div
      data-slot="native-select-wrapper"
      data-size={size}
      className={cn(
        "group/native-select relative w-fit has-[select:disabled]:opacity-50",
        className
      )}
    >
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "h-9 w-full min-w-0 appearance-none rounded-lg border border-input bg-card",
          "py-1 pr-8 pl-3 text-sm",
          "transition-[border-color,background-color,box-shadow] duration-fast ease-out outline-none select-none",
          "selection:bg-primary selection:text-primary-foreground",
          "placeholder:text-foreground-tertiary",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "disabled:pointer-events-none disabled:cursor-not-allowed",
          "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
          // sm
          "data-[size=sm]:h-8 data-[size=sm]:rounded-md data-[size=sm]:text-xs",
          // Dark — invalid ring only; bg-card handles light/dark automatically
          "dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40"
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        data-slot="native-select-icon"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-foreground-tertiary select-none"
      />
    </div>
  )
}

function NativeSelectOption({ className, ...props }: React.ComponentProps<"option">) {
  return (
    <option
      data-slot="native-select-option"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

function NativeSelectOptGroup({ className, ...props }: React.ComponentProps<"optgroup">) {
  return (
    <optgroup
      data-slot="native-select-optgroup"
      className={cn("bg-[Canvas] text-[CanvasText]", className)}
      {...props}
    />
  )
}

export { NativeSelect, NativeSelectOptGroup, NativeSelectOption }
