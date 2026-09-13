import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "./lib/utils"

/**
 * Switch v2.2 redesign:
 *  - Thumb gains `shadow-[0_1px_4px_rgba(0,0,0,.22)]` — a subtle drop shadow
 *    that conveys physical depth and makes the thumb "float" above the track.
 *  - Dark theme thumb uses `dark:data-unchecked:bg-foreground` (near-white) so
 *    it stays clearly visible against the dark input track.
 *  - `sm` size unchanged.
 */
function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full",
        "border border-transparent",
        "transition-[background-color,border-color,box-shadow] duration-fast ease-out outline-none",
        // Extra tap target
        "after:absolute after:-inset-x-3 after:-inset-y-2",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        "dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        // Sizes
        "data-[size=default]:h-6 data-[size=default]:w-11",
        "data-[size=sm]:h-5 data-[size=sm]:w-9",
        // Track colours
        "data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80",
        "data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block translate-x-0.5 rounded-full bg-background ring-0",
          // Thumb shadow — the key redesign detail
          "shadow-[0_1px_4px_rgba(0,0,0,.22)]",
          "transition-transform duration-fast ease-out",
          // Default size
          "group-data-[size=default]/switch:size-5",
          "group-data-[size=default]/switch:data-checked:translate-x-[calc(100%-2px)]",
          // SM size
          "group-data-[size=sm]/switch:size-4",
          "group-data-[size=sm]/switch:data-checked:translate-x-[calc(100%-2px)]",
          // Dark: unchecked thumb needs to read on dark input track
          "dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
