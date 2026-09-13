import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible"

import { cn } from "./lib/utils"
import { ChevronDownIcon } from "lucide-react"

/**
 * Collapsible v2.2 redesign:
 *  - Trigger open state: `text-brand-text font-semibold` (mirrors Accordion).
 *  - Chevron rotates 180° on open via `data-panel-open` parent attribute.
 *  - Panel uses smooth height animation via `data-open` / `data-closed`.
 */

function Collapsible({ className, ...props }: CollapsiblePrimitive.Root.Props) {
  return (
    <CollapsiblePrimitive.Root
      data-slot="collapsible"
      className={cn("group/collapsible", className)}
      {...props}
    />
  )
}

function CollapsibleTrigger({
  className,
  children,
  ...props
}: CollapsiblePrimitive.Trigger.Props) {
  return (
    <CollapsiblePrimitive.Trigger
      data-slot="collapsible-trigger"
      className={cn(
        "flex w-full items-center justify-between gap-2",
        "rounded-lg border border-transparent py-2.5 text-left text-sm font-medium",
        "transition-colors duration-fast ease-out outline-none",
        "hover:text-foreground",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        // Open state
        "group-data-open/collapsible:text-brand-text group-data-open/collapsible:font-semibold",
        "[&_[data-slot=collapsible-icon]]:transition-transform [&_[data-slot=collapsible-icon]]:duration-fast [&_[data-slot=collapsible-icon]]:ease-out",
        "group-data-open/collapsible:[&_[data-slot=collapsible-icon]]:rotate-180",
        className
      )}
      {...props}
    >
      {children}
      <ChevronDownIcon
        data-slot="collapsible-icon"
        className="size-4 shrink-0 text-muted-foreground group-data-open/collapsible:text-brand-text"
      />
    </CollapsiblePrimitive.Trigger>
  )
}

function CollapsibleContent({
  className,
  ...props
}: CollapsiblePrimitive.Panel.Props) {
  return (
    <CollapsiblePrimitive.Panel
      data-slot="collapsible-content"
      className={cn(
        "overflow-hidden text-sm text-muted-foreground",
        "data-open:animate-accordion-down data-closed:animate-accordion-up",
        className
      )}
      {...props}
    />
  )
}

export { Collapsible, CollapsibleTrigger, CollapsibleContent }
