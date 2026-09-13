import { Accordion as AccordionPrimitive } from "@base-ui/react/accordion"

import { cn } from "./lib/utils"
import { ChevronDownIcon } from "lucide-react"

/**
 * Accordion v2.2 redesign:
 *  - Single chevron (ChevronDown) rotates 180° on open via `group-aria-expanded`
 *    — smoother than swapping two icons.
 *  - Open trigger: `text-brand-text font-semibold` for clear active state.
 *  - Border between items uses `border-border-subtle` (lighter than before).
 *  - Content padding-top 12px (was 0) for breathing room below the trigger.
 */

function Accordion({ className, ...props }: AccordionPrimitive.Root.Props) {
  return (
    <AccordionPrimitive.Root
      data-slot="accordion"
      className={cn("flex w-full flex-col", className)}
      {...props}
    />
  )
}

function AccordionItem({ className, ...props }: AccordionPrimitive.Item.Props) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("border-b border-border-subtle last:border-0", className)}
      {...props}
    />
  )
}

function AccordionTrigger({
  className,
  children,
  ...props
}: AccordionPrimitive.Trigger.Props) {
  return (
    <AccordionPrimitive.Header className="flex">
      <AccordionPrimitive.Trigger
        data-slot="accordion-trigger"
        className={cn(
          "group/accordion-trigger relative flex flex-1 items-center justify-between",
          "rounded-lg border border-transparent py-3 text-left text-sm font-medium",
          "transition-colors duration-fast ease-out outline-none",
          // Focus ring
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          // Disabled
          "aria-disabled:pointer-events-none aria-disabled:opacity-50",
          // Active (open) state — brand text + semibold
          "aria-expanded:text-brand-text aria-expanded:font-semibold",
          // Icon sizing
          "**:data-[slot=accordion-trigger-icon]:ml-auto **:data-[slot=accordion-trigger-icon]:size-4 **:data-[slot=accordion-trigger-icon]:text-muted-foreground **:data-[slot=accordion-trigger-icon]:shrink-0",
          "aria-expanded:**:data-[slot=accordion-trigger-icon]:text-brand-text",
          className
        )}
        {...props}
      >
        {children}
        {/* Single chevron that rotates — no icon swap */}
        <ChevronDownIcon
          data-slot="accordion-trigger-icon"
          className="pointer-events-none transition-transform duration-fast ease-out group-aria-expanded/accordion-trigger:rotate-180"
        />
      </AccordionPrimitive.Trigger>
    </AccordionPrimitive.Header>
  )
}

function AccordionContent({
  className,
  children,
  ...props
}: AccordionPrimitive.Panel.Props) {
  return (
    <AccordionPrimitive.Panel
      data-slot="accordion-content"
      className="overflow-hidden text-sm data-open:animate-accordion-down data-closed:animate-accordion-up"
      {...props}
    >
      <div
        className={cn(
          "h-(--accordion-panel-height) pb-3 pt-1 text-muted-foreground leading-relaxed",
          "data-ending-style:h-0 data-starting-style:h-0",
          "[&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-brand-text",
          "[&_p:not(:last-child)]:mb-4",
          className
        )}
      >
        {children}
      </div>
    </AccordionPrimitive.Panel>
  )
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent }
