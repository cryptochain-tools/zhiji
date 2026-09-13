import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { cn } from "./lib/utils"
import { Button } from "./button"

/**
 * AlertDialog v2.2 redesign:
 *  - No close button (AlertDialog forces the user to make a choice).
 *  - Overlay same as Dialog: `bg-overlay` token.
 *  - Content identical to Dialog but without the X close button.
 *  - Footer: `bg-muted` + forced `sm:flex-row` (action buttons always right-align).
 *  - Title font-semibold for stronger hierarchy on destructive confirmations.
 */

function AlertDialog({ ...props }: AlertDialogPrimitive.Root.Props) {
  return <AlertDialogPrimitive.Root data-slot="alert-dialog" {...props} />
}

function AlertDialogTrigger({
  asChild,
  children,
  ...props
}: AlertDialogPrimitive.Trigger.Props & {
  asChild?: boolean
  children?: React.ReactElement
}) {
  return (
    <AlertDialogPrimitive.Trigger
      data-slot="alert-dialog-trigger"
      render={asChild ? children : undefined}
      {...props}
    >
      {asChild ? undefined : children}
    </AlertDialogPrimitive.Trigger>
  )
}

function AlertDialogPortal({ ...props }: AlertDialogPrimitive.Portal.Props) {
  return <AlertDialogPrimitive.Portal data-slot="alert-dialog-portal" {...props} />
}

function AlertDialogOverlay({ className, ...props }: AlertDialogPrimitive.Backdrop.Props) {
  return (
    <AlertDialogPrimitive.Backdrop
      data-slot="alert-dialog-overlay"
      className={cn(
        "fixed inset-0 isolate z-50 bg-overlay duration-fast ease-out",
        "supports-backdrop-filter:backdrop-blur-xs",
        "data-open:animate-in data-open:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
        className,
      )}
      {...props}
    />
  )
}

function AlertDialogContent({ className, children, ...props }: AlertDialogPrimitive.Popup.Props) {
  return (
    <AlertDialogPortal>
      <AlertDialogOverlay />
      <AlertDialogPrimitive.Popup
        data-slot="alert-dialog-content"
        className={cn(
          "fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)]",
          "-translate-x-1/2 -translate-y-1/2",
          "gap-4 rounded-xl bg-dialog p-6 text-sm text-popover-foreground",
          "ring-1 ring-border-subtle shadow-card",
          "duration-fast ease-out outline-none sm:max-w-md",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
      </AlertDialogPrimitive.Popup>
    </AlertDialogPortal>
  )
}

function AlertDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  )
}

function AlertDialogFooter({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-dialog-footer"
      className={cn(
        "-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-xl border-t border-border-subtle bg-muted p-6",
        "sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  )
}

function AlertDialogTitle({ className, ...props }: AlertDialogPrimitive.Title.Props) {
  return (
    <AlertDialogPrimitive.Title
      data-slot="alert-dialog-title"
      className={cn("font-heading text-h3 leading-none font-semibold", className)}
      {...props}
    />
  )
}

function AlertDialogDescription({ className, ...props }: AlertDialogPrimitive.Description.Props) {
  return (
    <AlertDialogPrimitive.Description
      data-slot="alert-dialog-description"
      className={cn("text-sm text-muted-foreground leading-relaxed", className)}
      {...props}
    />
  )
}

function AlertDialogAction({ className, ...props }: React.ComponentProps<typeof Button>) {
  return <Button data-slot="alert-dialog-action" className={cn(className)} {...props} />
}

function AlertDialogCancel({ className, ...props }: React.ComponentProps<typeof Button>) {
  return (
    <AlertDialogPrimitive.Close
      render={<Button variant="outline" data-slot="alert-dialog-cancel" className={cn(className)} {...props} />}
    />
  )
}

export {
  AlertDialog, AlertDialogTrigger, AlertDialogPortal, AlertDialogOverlay,
  AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
}
