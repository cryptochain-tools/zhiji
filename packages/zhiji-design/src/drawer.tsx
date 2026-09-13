"use client"

import * as React from "react"
import { Drawer as DrawerPrimitive } from "vaul"

import { cn } from "./lib/utils"

/**
 * Drawer v2.2 redesign:
 *  - Overlay: `bg-black/10` → `bg-overlay` token (consistent with Dialog/Sheet).
 *  - Handle bar: shown only for bottom direction, `bg-border` (more visible
 *    than the old muted color).
 *  - Title: font-medium → `font-semibold + text-h3` (matches Dialog hierarchy).
 *  - Header padding: gap-1 (was gap-0.5) for breathing room.
 *  - Footer: bg-muted + border-top for visible separation (matches Dialog).
 */

function Drawer({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Root>) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

function DrawerTrigger({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Trigger>) {
  return <DrawerPrimitive.Trigger data-slot="drawer-trigger" {...props} />
}

function DrawerPortal({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Portal>) {
  return <DrawerPrimitive.Portal data-slot="drawer-portal" {...props} />
}

function DrawerClose({ ...props }: React.ComponentProps<typeof DrawerPrimitive.Close>) {
  return <DrawerPrimitive.Close data-slot="drawer-close" {...props} />
}

function DrawerOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Overlay>) {
  return (
    <DrawerPrimitive.Overlay
      data-slot="drawer-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-overlay",
        "supports-backdrop-filter:backdrop-blur-xs",
        "data-open:animate-in data-open:fade-in-0",
        "data-closed:animate-out data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function DrawerContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Content>) {
  return (
    <DrawerPortal data-slot="drawer-portal">
      <DrawerOverlay />
      <DrawerPrimitive.Content
        data-slot="drawer-content"
        className={cn(
          "group/drawer-content fixed z-50 flex h-auto flex-col bg-popover text-sm text-popover-foreground",
          // Bottom
          "data-[vaul-drawer-direction=bottom]:inset-x-0 data-[vaul-drawer-direction=bottom]:bottom-0",
          "data-[vaul-drawer-direction=bottom]:mt-24 data-[vaul-drawer-direction=bottom]:max-h-[80vh]",
          "data-[vaul-drawer-direction=bottom]:rounded-t-2xl",
          "data-[vaul-drawer-direction=bottom]:border-t data-[vaul-drawer-direction=bottom]:border-border-subtle",
          // Top
          "data-[vaul-drawer-direction=top]:inset-x-0 data-[vaul-drawer-direction=top]:top-0",
          "data-[vaul-drawer-direction=top]:mb-24 data-[vaul-drawer-direction=top]:max-h-[80vh]",
          "data-[vaul-drawer-direction=top]:rounded-b-2xl",
          "data-[vaul-drawer-direction=top]:border-b data-[vaul-drawer-direction=top]:border-border-subtle",
          // Left
          "data-[vaul-drawer-direction=left]:inset-y-0 data-[vaul-drawer-direction=left]:left-0",
          "data-[vaul-drawer-direction=left]:w-3/4 data-[vaul-drawer-direction=left]:rounded-r-xl",
          "data-[vaul-drawer-direction=left]:border-r data-[vaul-drawer-direction=left]:border-border-subtle",
          // Right
          "data-[vaul-drawer-direction=right]:inset-y-0 data-[vaul-drawer-direction=right]:right-0",
          "data-[vaul-drawer-direction=right]:w-3/4 data-[vaul-drawer-direction=right]:rounded-l-xl",
          "data-[vaul-drawer-direction=right]:border-l data-[vaul-drawer-direction=right]:border-border-subtle",
          // Responsive max width
          "data-[vaul-drawer-direction=left]:sm:max-w-md data-[vaul-drawer-direction=right]:sm:max-w-md",
          className
        )}
        {...props}
      >
        {/* Handle bar — only for bottom direction */}
        <div
          aria-hidden="true"
          className="mx-auto mt-3 hidden h-1 w-9 shrink-0 rounded-full bg-border group-data-[vaul-drawer-direction=bottom]/drawer-content:block"
        />
        {children}
      </DrawerPrimitive.Content>
    </DrawerPortal>
  )
}

function DrawerHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-header"
      className={cn(
        "flex flex-col gap-1 p-5 pb-3",
        "group-data-[vaul-drawer-direction=bottom]/drawer-content:text-center",
        "group-data-[vaul-drawer-direction=top]/drawer-content:text-center",
        "md:text-left",
        className
      )}
      {...props}
    />
  )
}

function DrawerFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="drawer-footer"
      className={cn(
        "mt-auto flex flex-col-reverse gap-2 border-t border-border-subtle bg-muted p-4",
        "sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DrawerTitle({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Title>) {
  return (
    <DrawerPrimitive.Title
      data-slot="drawer-title"
      className={cn("font-heading text-h3 font-semibold text-foreground leading-snug", className)}
      {...props}
    />
  )
}

function DrawerDescription({
  className,
  ...props
}: React.ComponentProps<typeof DrawerPrimitive.Description>) {
  return (
    <DrawerPrimitive.Description
      data-slot="drawer-description"
      className={cn("text-sm text-muted-foreground leading-relaxed", className)}
      {...props}
    />
  )
}

export {
  Drawer, DrawerPortal, DrawerOverlay,
  DrawerTrigger, DrawerClose, DrawerContent,
  DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription,
}
