import * as React from "react"
import { ScrollArea as ScrollAreaPrimitive } from "@base-ui/react/scroll-area"

import { cn } from "./lib/utils"

/**
 * ScrollArea v2.2 redesign:
 *  - Scrollbar slimmer: 6 px (was 10 px), keeping content density.
 *  - Thumb: `bg-border` default, `hover:bg-foreground-tertiary` on hover.
 *  - Track: fully transparent (no border lines), cleaner look.
 *  - Transitions tokenized.
 */

function ScrollArea({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.Root.Props) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      className={cn("relative", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport
        data-slot="scroll-area-viewport"
        className={cn(
          "size-full rounded-[inherit]",
          "transition-[color,box-shadow] duration-fast ease-out outline-none",
          "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1"
        )}
      >
        {children}
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  )
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.Scrollbar.Props) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      data-slot="scroll-area-scrollbar"
      data-orientation={orientation}
      orientation={orientation}
      className={cn(
        "flex touch-none p-px transition-colors duration-fast ease-out select-none",
        // Slimmer scrollbar
        "data-horizontal:h-1.5 data-horizontal:flex-col",
        "data-vertical:h-full data-vertical:w-1.5",
        className
      )}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb
        data-slot="scroll-area-thumb"
        className={cn(
          "relative flex-1 rounded-full bg-border",
          "transition-colors duration-fast ease-out",
          "hover:bg-foreground-tertiary"
        )}
      />
    </ScrollAreaPrimitive.Scrollbar>
  )
}

export { ScrollArea, ScrollBar }
