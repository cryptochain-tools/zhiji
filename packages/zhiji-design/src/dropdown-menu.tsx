import * as React from "react"
import { Menu as MenuPrimitive } from "@base-ui/react/menu"
import { ChevronRightIcon, CheckIcon } from "lucide-react"

import { cn } from "./lib/utils"

/**
 * DropdownMenu v2.2 redesign:
 *  - Popup border: `ring-foreground/10` → `border border-border-subtle + shadow-card`
 *    (same as Select / Popover for unified popup vocabulary).
 *  - Item hover: `bg-accent text-accent-foreground` (brand-muted bg, brand-text fg).
 *  - Destructive item: `bg-destructive/10` on focus, `text-destructive` always.
 *  - Submenu trigger uses identical hover treatment.
 */

function DropdownMenu({ ...props }: MenuPrimitive.Root.Props) {
  return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: MenuPrimitive.Portal.Props) {
  return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: MenuPrimitive.Trigger.Props & {
  asChild?: boolean
  children?: React.ReactElement
}) {
  return (
    <MenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      render={asChild ? children : undefined}
      {...props}
    >
      {asChild ? undefined : children}
    </MenuPrimitive.Trigger>
  )
}

const popupClass = cn(
  // 旧版用 w-(--anchor-width) 把弹层宽度锁死 = trigger 宽度,Menubar/ContextMenu
  // 的 trigger 通常只有 30-50px,叠加 min-w-32 兜底也只到 128px,长 item 会被强制
  // 换行(例如 "New workspace ⌘N" 被压成两行)。
  // 新版:w-fit 按内容撑开 + [min-width:max(8rem,var(--anchor-width))] 保证"至少
  // 和 trigger 同宽且不小于 128px"。具体下限由各消费者(MenubarContent / ContextMenu)
  // 用 min-w-* 覆盖。
  "z-50 max-h-(--available-height) w-fit [min-width:max(8rem,var(--anchor-width))]",
  "origin-(--transform-origin) overflow-x-hidden overflow-y-auto",
  "rounded-lg border border-border-subtle bg-popover p-1 text-popover-foreground",
  "shadow-card duration-100 outline-none",
  "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
  "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
  "data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95",
  "data-closed:animate-out data-closed:overflow-hidden data-closed:fade-out-0 data-closed:zoom-out-95"
)

function DropdownMenuContent({
  align = "start",
  alignOffset = 0,
  side = "bottom",
  sideOffset = 4,
  className,
  ...props
}: MenuPrimitive.Popup.Props &
  Pick<MenuPrimitive.Positioner.Props, "align" | "alignOffset" | "side" | "sideOffset">) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        className="isolate z-50 outline-none"
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          data-slot="dropdown-menu-content"
          className={cn(popupClass, className)}
          {...props}
        />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  )
}

function DropdownMenuGroup({ ...props }: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<"div"> & { inset?: boolean }) {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      role="presentation"
      className={cn(
        "px-1.5 py-1 text-xs font-semibold uppercase tracking-wide text-foreground-tertiary",
        "data-inset:pl-7",
        className
      )}
      {...props}
    />
  )
}

const itemClass = cn(
  "group/dropdown-menu-item relative flex cursor-default items-center gap-1.5",
  "rounded-md px-1.5 py-1.5 text-sm outline-hidden select-none",
  "transition-colors duration-fast ease-out",
  "focus:bg-accent focus:text-accent-foreground",
  "not-data-[variant=destructive]:focus:**:text-accent-foreground",
  "data-inset:pl-7",
  // Destructive
  "data-[variant=destructive]:text-destructive",
  "data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive",
  "dark:data-[variant=destructive]:focus:bg-destructive/20",
  "data-[variant=destructive]:*:[svg]:text-destructive",
  "data-disabled:pointer-events-none data-disabled:opacity-50",
  "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
)

function DropdownMenuItem({
  className,
  inset,
  destructive,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean
  destructive?: boolean
  variant?: "default" | "destructive"
}) {
  const resolvedVariant = destructive ? "destructive" : variant
  return (
    <MenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={resolvedVariant}
      className={cn(itemClass, className)}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & { inset?: boolean }) {
  return (
    <MenuPrimitive.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1.5 text-sm outline-hidden select-none",
        "transition-colors duration-fast ease-out",
        "focus:bg-accent focus:text-accent-foreground",
        "data-popup-open:bg-accent data-popup-open:text-accent-foreground",
        "data-open:bg-accent data-open:text-accent-foreground",
        "data-inset:pl-7",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  align = "start",
  alignOffset = -3,
  side = "right",
  sideOffset = 0,
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuContent>) {
  return (
    <DropdownMenuContent
      data-slot="dropdown-menu-sub-content"
      className={cn("w-auto min-w-24", className)}
      align={align}
      alignOffset={alignOffset}
      side={side}
      sideOffset={sideOffset}
      {...props}
    />
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  inset,
  ...props
}: MenuPrimitive.CheckboxItem.Props & { inset?: boolean }) {
  return (
    <MenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-1.5 text-sm",
        "outline-hidden select-none transition-colors duration-fast ease-out",
        "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground",
        "data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <MenuPrimitive.CheckboxItemIndicator>
          <CheckIcon />
        </MenuPrimitive.CheckboxItemIndicator>
      </span>
      {children}
    </MenuPrimitive.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  inset,
  ...props
}: MenuPrimitive.RadioItem.Props & { inset?: boolean }) {
  return (
    <MenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      data-inset={inset}
      className={cn(
        "relative flex cursor-default items-center gap-1.5 rounded-md py-1.5 pr-8 pl-1.5 text-sm",
        "outline-hidden select-none transition-colors duration-fast ease-out",
        "focus:bg-accent focus:text-accent-foreground focus:**:text-accent-foreground",
        "data-inset:pl-7 data-disabled:pointer-events-none data-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      <span className="pointer-events-none absolute right-2 flex items-center justify-center">
        <MenuPrimitive.RadioItemIndicator>
          <CheckIcon />
        </MenuPrimitive.RadioItemIndicator>
      </span>
      {children}
    </MenuPrimitive.RadioItem>
  )
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return (
    <MenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      className={cn("-mx-1 my-1 h-px bg-border-subtle", className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto text-xs tracking-widest text-foreground-tertiary",
        "group-focus/dropdown-menu-item:text-accent-foreground",
        className
      )}
      {...props}
    />
  )
}

export {
  DropdownMenu, DropdownMenuPortal, DropdownMenuTrigger,
  DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel,
  DropdownMenuItem, DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
  DropdownMenuSeparator, DropdownMenuShortcut,
  DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
}
