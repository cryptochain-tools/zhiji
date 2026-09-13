import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Skeleton v2.2 redesign:
 *  - Shimmer sweep animation replaces flat animate-pulse.
 *  - Background: two-stop gradient that sweeps left-to-right using
 *    `animate-shimmer` (defined in globals-additions.css).
 *  - Falls back gracefully to bg-muted if the animation is not yet loaded.
 *  - Requires adding `globals-additions.css` keyframes to globals.css.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn(
        "animate-shimmer rounded-md bg-muted",
        "[background-image:linear-gradient(90deg,var(--muted)_25%,color-mix(in_srgb,var(--muted)_50%,var(--card))_50%,var(--muted)_75%)]",
        "[background-size:200%_100%]",
        className
      )}
      {...props}
    />
  )
}

export { Skeleton }
