"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./lib/utils"
import { Button } from "./button"
import { Input } from "./input"
import { Textarea } from "./textarea"

/**
 * InputGroup v2.1 redesign — 与 Input v2.4 token 体系对齐：
 *  - 过渡 token 化：`transition-colors` → `transition-[border-color,background-color,box-shadow] duration-fast ease-out`。
 *  - 背景统一到 `bg-card`（与 Input v2.4 一致：亮=白 / 暗=深 card），对齐
 *    packages/design/CLAUDE.md 第 9 条；删除 `bg-field` / `dark:bg-input/30` 旧补丁。
 *  - Focus 仅 ring + border 变化，不再做 `focus-within:bg-card` 抬升（原本就是 bg-card）。
 *  - Disabled 底改用 `bg-muted`（替代旧的 `bg-input/50` 半透明），删除 dark 补丁。
 *  - InputGroupAddon (inline-start / inline-end) 与 InputAddon 视觉同款：
 *      bg-muted、`text-foreground-tertiary`、`font-semibold`、对内一条 border-subtle 分隔线。
 *  - 移除 InputGroupButton 上的死 `size="sm"` 变体（CVA 值为空字符串，符合
 *    "no dead props" 项目规则）。
 *  - InputGroupInput/Textarea 显式 `h-full` 重置，让内层 Input 受外壳 `h-8` 约束，
 *    修复旧版被 Input v2.2 的 h-10 撑高的隐性 bug。
 */

function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex h-8 w-full min-w-0 items-center rounded-lg border border-input bg-card outline-none",
        "transition-[border-color,background-color,box-shadow] duration-fast ease-out",
        // Combobox context: suppress own focus chrome
        "in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0",
        // Disabled
        "has-disabled:bg-muted has-disabled:opacity-50",
        // Focus
        "has-[[data-slot=input-group-control]:focus-visible]:border-ring",
        "has-[[data-slot=input-group-control]:focus-visible]:ring-3",
        "has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50",
        // Invalid
        "has-[[data-slot][aria-invalid=true]]:border-destructive",
        "has-[[data-slot][aria-invalid=true]]:ring-3",
        "has-[[data-slot][aria-invalid=true]]:ring-destructive/20",
        "dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40",
        // Block-aligned addon: stack vertically, drop fixed height
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col",
        "has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col",
        "has-[>textarea]:h-auto",
        // Inner input padding tweak so it sits flush against addon edge
        "has-[>[data-align=block-end]]:[&>input]:pt-3",
        "has-[>[data-align=block-start]]:[&>input]:pb-3",
        "has-[>[data-align=inline-end]]:[&>input]:pr-1.5",
        "has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        className,
      )}
      {...props}
    />
  )
}

const inputGroupAddonVariants = cva(
  "flex h-auto cursor-text items-center justify-center gap-2 select-none group-data-[disabled=true]/input-group:opacity-50 [&>kbd]:rounded-[calc(var(--radius-lg)-5px)] [&>svg:not([class*='size-'])]:size-4",
  {
    variants: {
      align: {
        // Inline 变体：与 Input.InputAddon 同款视觉 —— muted 底 + 内向 border-subtle 分隔 + 半粗体 fg-tertiary。
        // 内圆角 = 外壳 rounded-lg (12px) - 1px border 厚度 = 11px，使 addon 贴合外壳内圆。
        // self-stretch 让 addon 撑满外壳高度（外壳是 flex items-center,默认子项不 stretch）,
        // 否则 addon 比外壳矮一截,圆角看起来与外壳错位。
        // py-0 重置默认 py-1.5(避免 addon 被自身 padding 撑高超过外壳)。
        // 当 addon 内仅含 <button> 时,去掉 bg-muted/border 让位给按钮自身视觉(has-[>button] 重置)。
        "inline-start":
          "order-first self-stretch bg-muted px-2.5 py-0 text-xs font-semibold text-foreground-tertiary border-r border-border-subtle rounded-l-[calc(var(--radius-lg)-1px)] has-[>button]:bg-transparent has-[>button]:border-r-0 has-[>button]:p-1 has-[>kbd]:ml-[-0.15rem]",
        "inline-end":
          "order-last self-stretch bg-muted px-2.5 py-0 text-xs font-semibold text-foreground-tertiary border-l border-border-subtle rounded-r-[calc(var(--radius-lg)-1px)] has-[>button]:bg-transparent has-[>button]:border-l-0 has-[>button]:p-1 has-[>kbd]:mr-[-0.15rem]",
        // Block 变体：保持原"上下条带"语义,无独立底色;border 由用户/上下文决定
        "block-start":
          "order-first w-full justify-start px-2.5 pt-2 text-sm font-medium text-muted-foreground group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
        "block-end":
          "order-last w-full justify-start px-2.5 pb-2 text-sm font-medium text-muted-foreground group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
      },
    },
    defaultVariants: {
      align: "inline-start",
    },
  },
)

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof inputGroupAddonVariants>) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(inputGroupAddonVariants({ align }), className)}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("button")) {
          return
        }
        e.currentTarget.parentElement?.querySelector("input")?.focus()
      }}
      {...props}
    />
  )
}

const inputGroupButtonVariants = cva(
  "flex items-center gap-2 text-sm shadow-none",
  {
    variants: {
      size: {
        // 圆角参考外壳 rounded-lg (12px)：button 在 addon 内时内嵌 4px → 8px (rounded-md)，
        // 视觉上呈"外 12 → 内 8"的同心圆角节奏，避免旧版 5px 与外壳错层。
        xs: "h-6 gap-1 rounded-md px-2 [&>svg:not([class*='size-'])]:size-3.5",
        "icon-xs":
          "size-6 rounded-md p-0 has-[>svg]:p-0",
        "icon-sm": "size-8 rounded-md p-0 has-[>svg]:p-0",
      },
    },
    defaultVariants: {
      size: "xs",
    },
  },
)

function InputGroupButton({
  className,
  type = "button",
  variant = "ghost",
  size = "xs",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "size" | "type"> &
  VariantProps<typeof inputGroupButtonVariants> & {
    type?: "button" | "submit" | "reset"
  }) {
  return (
    <Button
      type={type}
      data-size={size}
      variant={variant}
      className={cn(inputGroupButtonVariants({ size }), className)}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground tabular-nums [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <Input
      data-slot="input-group-control"
      className={cn(
        "h-full flex-1 rounded-none border-0 bg-transparent shadow-none ring-0",
        "focus-visible:bg-transparent focus-visible:ring-0 focus-visible:border-0",
        "disabled:bg-transparent aria-invalid:ring-0",
        "dark:bg-transparent dark:focus-visible:bg-transparent dark:disabled:bg-transparent",
        className,
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      data-slot="input-group-control"
      className={cn(
        "flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0",
        "focus-visible:bg-transparent focus-visible:ring-0 focus-visible:border-0",
        "disabled:bg-transparent aria-invalid:ring-0",
        "dark:bg-transparent dark:focus-visible:bg-transparent dark:disabled:bg-transparent",
        className,
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupText,
  InputGroupInput,
  InputGroupTextarea,
}
