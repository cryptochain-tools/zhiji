import { cn } from "./lib/utils"

/**
 * Kbd v2.2 redesign:
 *  - Added `shadow-[0_1px_0_var(--border)]` bottom shadow — gives the key
 *    cap a physical "raised" feel consistent with actual keyboard keycaps.
 *  - In tooltip/dark context: semi-transparent bg + light text
 *    (`in-data-[slot=tooltip-content]:bg-background/20`) unchanged.
 */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1",
        "rounded-sm border border-border bg-muted px-1",
        "font-sans text-xs font-medium text-muted-foreground select-none",
        // Raised keycap shadow
        "shadow-[0_1px_0_var(--border)]",
        // Tooltip context — invert for dark bg
        "in-data-[slot=tooltip-content]:bg-background/20 in-data-[slot=tooltip-content]:text-background in-data-[slot=tooltip-content]:border-transparent in-data-[slot=tooltip-content]:shadow-none",
        "dark:in-data-[slot=tooltip-content]:bg-background/10",
        "[&_svg:not([class*='size-'])]:size-3",
        className
      )}
      {...props}
    />
  )
}

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  )
}

export { Kbd, KbdGroup }
