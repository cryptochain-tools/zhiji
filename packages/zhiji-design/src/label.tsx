import { cn } from "./lib/utils"

/**
 * Label v2.2 — no structural change; weight stays font-medium (500).
 * Removed stray `group-data-[disabled=true]` peer chain that could
 * accidentally apply to non-sibling disabled inputs.
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none",
        "group-data-[disabled=true]/field:pointer-events-none group-data-[disabled=true]/field:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

export { Label }
