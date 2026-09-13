import { Separator as SeparatorPrimitive } from "@base-ui/react/separator"

import { cn } from "./lib/utils"

/**
 * Separator v2.2 redesign:
 *  - Color changed from `bg-border` → `bg-border-subtle` — a lighter
 *    divider that doesn't compete with card/panel borders visually.
 *  - Vertical variant uses `self-stretch` so it auto-fills parent height
 *    without needing an explicit `h-` value.
 */
function Separator({
  className,
  orientation = "horizontal",
  ...props
}: SeparatorPrimitive.Props) {
  return (
    <SeparatorPrimitive
      data-slot="separator"
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border-subtle",
        "data-horizontal:h-px data-horizontal:w-full",
        "data-vertical:w-px data-vertical:self-stretch",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
