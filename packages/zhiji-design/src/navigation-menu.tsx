import * as React from "react"
import { NavigationMenu as NavigationMenuPrimitive } from "@base-ui/react/navigation-menu"
import { cva } from "class-variance-authority"
import { ChevronDownIcon } from "lucide-react"

import { cn } from "./lib/utils"

/**
 * NavigationMenu v2.2 redesign:
 *  - Trigger hover/active: `bg-accent` (brand-muted) instead of `bg-muted`,
 *    so non-link active state can be distinguished from neutral hover.
 *  - NavigationMenuLink active: `bg-brand-muted text-brand-text font-semibold`
 *    consistent with Tabs / Toggle active states.
 *  - Popup ring → `border-border-subtle` (unified popup vocabulary).
 *  - Trigger height: h-9 (matches Button default).
 */

function NavigationMenu({
  align = "start",
  className,
  children,
  ...props
}: NavigationMenuPrimitive.Root.Props &
  Pick<NavigationMenuPrimitive.Positioner.Props, "align">) {
  return (
    <NavigationMenuPrimitive.Root
      data-slot="navigation-menu"
      className={cn(
        "group/navigation-menu relative flex max-w-max flex-1 items-center justify-center",
        className
      )}
      {...props}
    >
      {children}
      <NavigationMenuPositioner align={align} />
    </NavigationMenuPrimitive.Root>
  )
}

function NavigationMenuList({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof NavigationMenuPrimitive.List>) {
  return (
    <NavigationMenuPrimitive.List
      data-slot="navigation-menu-list"
      className={cn(
        "group flex flex-1 list-none items-center justify-center gap-0.5",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuItem({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof NavigationMenuPrimitive.Item>) {
  return (
    <NavigationMenuPrimitive.Item
      data-slot="navigation-menu-item"
      className={cn("relative", className)}
      {...props}
    />
  )
}

const navigationMenuTriggerStyle = cva(
  [
    "group/navigation-menu-trigger inline-flex h-9 w-max items-center justify-center gap-1.5",
    "rounded-lg px-3 py-1.5 text-sm font-medium",
    "transition-all duration-fast ease-out outline-none",
    "hover:bg-muted focus:bg-muted",
    "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1",
    "disabled:pointer-events-none disabled:opacity-50",
    "data-popup-open:bg-accent data-popup-open:text-accent-foreground",
    "data-open:bg-accent data-open:text-accent-foreground",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
  ].join(" ")
)

function NavigationMenuTrigger({
  className,
  children,
  ...props
}: NavigationMenuPrimitive.Trigger.Props) {
  return (
    <NavigationMenuPrimitive.Trigger
      data-slot="navigation-menu-trigger"
      className={cn(navigationMenuTriggerStyle(), "group", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon
        aria-hidden="true"
        className={cn(
          "relative top-px ml-1 size-3 transition-transform duration-fast ease-out",
          "group-data-popup-open/navigation-menu-trigger:rotate-180",
          "group-data-open/navigation-menu-trigger:rotate-180"
        )}
      />
    </NavigationMenuPrimitive.Trigger>
  )
}

function NavigationMenuContent({
  className,
  ...props
}: NavigationMenuPrimitive.Content.Props) {
  return (
    <NavigationMenuPrimitive.Content
      data-slot="navigation-menu-content"
      className={cn(
        "h-full w-auto p-2 transition-[opacity,transform,translate] duration-[.35s] ease-[cubic-bezier(.22,1,.36,1)]",
        // Standalone (no viewport) popup styling
        "group-data-[viewport=false]/navigation-menu:rounded-lg",
        "group-data-[viewport=false]/navigation-menu:border group-data-[viewport=false]/navigation-menu:border-border-subtle",
        "group-data-[viewport=false]/navigation-menu:bg-popover group-data-[viewport=false]/navigation-menu:text-popover-foreground",
        "group-data-[viewport=false]/navigation-menu:shadow-card",
        "group-data-[viewport=false]/navigation-menu:duration-300",
        // Motion
        "data-ending-style:opacity-0 data-starting-style:opacity-0",
        "data-[motion=from-end]:slide-in-from-right-52 data-[motion=from-start]:slide-in-from-left-52",
        "data-[motion=to-end]:slide-out-to-right-52 data-[motion=to-start]:slide-out-to-left-52",
        "data-[motion^=from-]:animate-in data-[motion^=from-]:fade-in",
        "data-[motion^=to-]:animate-out data-[motion^=to-]:fade-out",
        "**:data-[slot=navigation-menu-link]:focus:ring-0 **:data-[slot=navigation-menu-link]:focus:outline-none",
        "group-data-[viewport=false]/navigation-menu:data-open:animate-in group-data-[viewport=false]/navigation-menu:data-open:fade-in-0",
        "group-data-[viewport=false]/navigation-menu:data-closed:animate-out group-data-[viewport=false]/navigation-menu:data-closed:fade-out-0",
        className
      )}
      {...props}
    />
  )
}

function NavigationMenuPositioner({
  className,
  side = "bottom",
  sideOffset = 8,
  align = "start",
  alignOffset = 0,
  ...props
}: NavigationMenuPrimitive.Positioner.Props) {
  return (
    <NavigationMenuPrimitive.Portal>
      <NavigationMenuPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        className={cn(
          "isolate z-50 h-(--positioner-height) w-(--positioner-width) max-w-(--available-width)",
          "transition-[top,left,right,bottom] duration-[.35s] ease-[cubic-bezier(.22,1,.36,1)]",
          "data-instant:transition-none",
          className
        )}
        {...props}
      >
        <NavigationMenuPrimitive.Popup
          className={cn(
            "xs:w-(--popup-width) relative h-(--popup-height) w-(--popup-width) origin-(--transform-origin)",
            "rounded-lg border border-border-subtle bg-popover text-popover-foreground shadow-card",
            "transition-[opacity,transform,width,height,scale,translate] duration-[.35s] ease-[cubic-bezier(.22,1,.36,1)] outline-none",
            "data-ending-style:scale-95 data-ending-style:opacity-0 data-ending-style:duration-150",
            "data-starting-style:scale-95 data-starting-style:opacity-0"
          )}
        >
          <NavigationMenuPrimitive.Viewport className="relative size-full overflow-hidden" />
        </NavigationMenuPrimitive.Popup>
      </NavigationMenuPrimitive.Positioner>
    </NavigationMenuPrimitive.Portal>
  )
}

function NavigationMenuLink({
  className,
  asChild,
  children,
  ...props
}: NavigationMenuPrimitive.Link.Props & {
  asChild?: boolean
  children?: React.ReactElement
}) {
  return (
    <NavigationMenuPrimitive.Link
      data-slot="navigation-menu-link"
      render={asChild ? children : undefined}
      className={cn(
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
        "transition-colors duration-fast ease-out outline-none",
        "hover:bg-muted focus:bg-muted",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-1",
        "in-data-[slot=navigation-menu-content]:rounded-md",
        // Active route — brand
        "data-active:bg-brand-muted data-active:font-semibold data-active:text-brand-text",
        "data-active:hover:bg-brand-muted data-active:focus:bg-brand-muted",
        "[&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {asChild ? undefined : children}
    </NavigationMenuPrimitive.Link>
  )
}

function NavigationMenuIndicator({
  className,
  ...props
}: React.ComponentPropsWithRef<typeof NavigationMenuPrimitive.Icon>) {
  return (
    <NavigationMenuPrimitive.Icon
      data-slot="navigation-menu-indicator"
      className={cn(
        "top-full z-1 flex h-1.5 items-end justify-center overflow-hidden",
        "data-[state=hidden]:animate-out data-[state=hidden]:fade-out",
        "data-[state=visible]:animate-in data-[state=visible]:fade-in",
        className
      )}
      {...props}
    >
      <div className="relative top-[60%] h-2 w-2 rotate-45 rounded-tl-sm bg-border-subtle shadow-md" />
    </NavigationMenuPrimitive.Icon>
  )
}

export {
  NavigationMenu, NavigationMenuContent, NavigationMenuIndicator,
  NavigationMenuItem, NavigationMenuLink, NavigationMenuList,
  NavigationMenuTrigger, navigationMenuTriggerStyle, NavigationMenuPositioner,
}
