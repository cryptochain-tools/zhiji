import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip"
import { ReactNode } from "react"

import { cn } from "./lib/utils"

/**
 * InfoTooltip v2.2 redesign:
 *  - Popup uses dark-reverse style consistent with Tooltip v2.2:
 *    `bg-foreground text-background` (strong contrast, modern feel).
 *  - Border/shadow simplified — dark bg already creates depth.
 *  - Default max-width tightened to 240px (was 280px).
 */

interface InfoTooltipProps {
  content: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}

export function InfoTooltip({
  content,
  children,
  className,
  contentClassName,
}: InfoTooltipProps) {
  if (!content) {
    return <>{children}</>
  }

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger
        render={
          <span
            tabIndex={0}
            className={cn(
              "inline-flex w-fit cursor-default items-center outline-none",
              "focus-visible:rounded-md focus-visible:ring-3 focus-visible:ring-ring/50",
              className,
            )}
          >
            {children}
          </span>
        }
      />
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Positioner
          side="bottom"
          sideOffset={8}
          className="isolate z-[140]"
        >
          <TooltipPrimitive.Popup
            data-slot="info-tooltip-content"
            className={cn(
              "min-w-[200px] max-w-[min(240px,calc(100vw-32px))] origin-(--transform-origin)",
              "whitespace-normal rounded-md bg-foreground px-3 py-2",
              "text-left text-xs leading-relaxed text-background",
              "shadow-sm",
              "data-[state=delayed-open]:animate-in data-[state=delayed-open]:fade-in-0 data-[state=delayed-open]:zoom-in-95",
              "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
              "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
              contentClassName,
            )}
          >
            {content}
          </TooltipPrimitive.Popup>
        </TooltipPrimitive.Positioner>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
