"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "./lib/utils"
import { Button } from "./button"

/**
 * Sheet v2.2 redesign:
 *  - Overlay: `bg-overlay` token (matches Dialog/AlertDialog).
 *  - Content: title font-semibold (was font-medium) — consistent with Dialog.
 *  - SheetHeader / SheetFooter padding tokenized (`gap-2`).
 *  - Footer: bg-muted + border-top for visible separation (matches Dialog).
 *  - Close button positioned at top-3 right-3 (consistent with Dialog).
 */

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-overlay transition-opacity duration-fast ease-out",
        "data-ending-style:opacity-0 data-starting-style:opacity-0",
        "supports-backdrop-filter:backdrop-blur-xs",
        className
      )}
      {...props}
    />
  )
}

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col bg-popover bg-clip-padding text-sm text-popover-foreground",
          "shadow-card transition duration-200 ease-in-out",
          "data-ending-style:opacity-0 data-starting-style:opacity-0",
          // Bottom
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:h-auto",
          "data-[side=bottom]:border-t data-[side=bottom]:border-border-subtle",
          "data-[side=bottom]:rounded-t-xl",
          "data-[side=bottom]:data-ending-style:translate-y-[2.5rem] data-[side=bottom]:data-starting-style:translate-y-[2.5rem]",
          // Top
          "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:h-auto",
          "data-[side=top]:border-b data-[side=top]:border-border-subtle",
          "data-[side=top]:rounded-b-xl",
          "data-[side=top]:data-ending-style:translate-y-[-2.5rem] data-[side=top]:data-starting-style:translate-y-[-2.5rem]",
          // Left
          "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-3/4",
          "data-[side=left]:border-r data-[side=left]:border-border-subtle",
          "data-[side=left]:data-ending-style:translate-x-[-2.5rem] data-[side=left]:data-starting-style:translate-x-[-2.5rem]",
          // Right
          "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-3/4",
          "data-[side=right]:border-l data-[side=right]:border-border-subtle",
          "data-[side=right]:data-ending-style:translate-x-[2.5rem] data-[side=right]:data-starting-style:translate-x-[2.5rem]",
          // Responsive max-width
          "data-[side=left]:sm:max-w-md data-[side=right]:sm:max-w-md",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            render={
              <Button variant="ghost" className="absolute top-3 right-3" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            }
          />
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 p-5 pb-3", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex flex-col-reverse gap-2 border-t border-border-subtle bg-muted p-4",
        "sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("font-heading text-h3 font-semibold text-foreground leading-snug", className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-sm text-muted-foreground leading-relaxed", className)}
      {...props}
    />
  )
}

export {
  Sheet, SheetTrigger, SheetClose, SheetContent,
  SheetHeader, SheetFooter, SheetTitle, SheetDescription,
}
