import * as React from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"

import { cn } from "./lib/utils"
import { Button } from "./button"
import { XIcon } from "lucide-react"

/**
 * Dialog v2.3 redesign:
 *  - Overlay: `bg-overlay` token (rgba 0,0,0,.4 light / .8 dark).
 *  - Content: `bg-dialog` token + `ring-1 ring-border-subtle` (was ring-foreground/10).
 *  - Mobile content: bottom sheet by default; `md:` restores centered desktop modal.
 *  - Footer: `bg-muted` (was bg-muted/50) for a more defined footer band.
 *  - Title: `font-semibold` (was font-medium).
 *  - Close button: ghost icon-sm Button (not custom styled).
 */

function Dialog({ ...props }: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  asChild,
  children,
  ...props
}: DialogPrimitive.Trigger.Props & {
  asChild?: boolean
  children?: React.ReactElement
}) {
  return (
    <DialogPrimitive.Trigger
      data-slot="dialog-trigger"
      render={asChild ? children : undefined}
      {...props}
    >
      {asChild ? undefined : children}
    </DialogPrimitive.Trigger>
  )
}

function DialogPortal({ ...props }: DialogPrimitive.Portal.Props) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({ className, ...props }: DialogPrimitive.Backdrop.Props) {
  return (
    <DialogPrimitive.Backdrop
      data-slot="dialog-overlay"
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

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: DialogPrimitive.Popup.Props & { showCloseButton?: boolean }) {
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Popup
        data-slot="dialog-content"
        className={cn(
          "fixed inset-x-4 bottom-4 z-50 grid w-auto max-w-none translate-x-0 translate-y-0",
          "max-h-[calc(100dvh_-_2rem_-_env(safe-area-inset-bottom))]",
          "md:top-1/2 md:left-1/2 md:right-auto md:bottom-auto md:w-full md:max-w-[calc(100%-2rem)]",
          "md:-translate-x-1/2 md:-translate-y-1/2",
          "gap-4 rounded-xl bg-dialog p-6 text-sm text-popover-foreground",
          "ring-1 ring-border-subtle shadow-card",
          "duration-fast ease-out outline-none md:max-w-lg",
          "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
          "data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            render={
              <Button variant="ghost" className="absolute top-2 right-2" size="icon-sm">
                <XIcon />
                <span className="sr-only">Close</span>
              </Button>
            }
          />
        )}
      </DialogPrimitive.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="dialog-header" className={cn("flex flex-col gap-2", className)} {...props} />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & { showCloseButton?: boolean }) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        // padding: px-6 py-4 (24/16) 比旧版 p-6 (24/24) 矮 16px,符合常规 dialog
        // footer 节奏;rounded-b-xl 与 content 外圆角对齐。
        "-mx-6 -mb-6 flex flex-col-reverse gap-2 rounded-b-xl border-t border-border-subtle bg-muted px-6 py-4",
        "sm:flex-row sm:justify-end",
        className,
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close render={<Button variant="outline">关闭</Button>} />
      )}
    </div>
  )
}

function DialogTitle({ className, ...props }: DialogPrimitive.Title.Props) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("font-heading text-h3 leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({ className, ...props }: DialogPrimitive.Description.Props) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn(
        "text-sm text-muted-foreground",
        "*:[a]:underline *:[a]:underline-offset-3 *:[a]:hover:text-brand-text",
        className,
      )}
      {...props}
    />
  )
}

export {
  Dialog, DialogClose, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogOverlay, DialogPortal,
  DialogTitle, DialogTrigger,
}
