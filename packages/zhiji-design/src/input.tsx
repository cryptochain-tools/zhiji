import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "./lib/utils"

/**
 * Input v2.4 redesign:
 *  - v2.2: Focus glow `focus-visible:ring-3 focus-visible:ring-ring/50`，与 Button /
 *    Checkbox 的焦点处理保持一致。
 *  - v2.2: 移动端 h-10、桌面 md:h-9；text-base mobile-first（避免 iOS Safari 自动放大）。
 *  - v2.3: 移除文件内同名 `InputGroup` 简版 —— 与 `input-group.tsx` 撞车。
 *  - v2.4: 默认底改 `bg-card`（亮=白 / 暗=深 card），对齐 packages/design/CLAUDE.md
 *    第 9 条"文本录入面默认 bg-card 不用 bg-field"。删除 `dark:bg-input/30` 与
 *    `dark:disabled:bg-input/80` 等基于 input alpha 叠加的暗色补丁，全部走纯
 *    `bg-card` / `bg-muted` token，亮暗一致。
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // Layout
        "h-10 w-full min-w-0 rounded-lg border border-input bg-card",
        "px-3 py-2 text-base font-medium",
        // Files
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        // Placeholder
        "placeholder:font-normal placeholder:text-foreground-tertiary",
        // Transitions
        "transition-[border-color,background-color,box-shadow] duration-fast ease-out outline-none",
        // Focus
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        // Disabled
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50",
        // Invalid
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        // iOS zoom prevention: keep text-base mobile, shrink on md+
        "md:h-9 md:text-sm",
        // Dark — invalid ring only; bg-card handles light/dark automatically
        "dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  )
}

// ── InputAddon ────────────────────────────────────────────────────────────────
// Inline addon (suffix/prefix) element for the SIMPLE single-addon case where
// you don't need the full InputGroup API. For multi-addon / button-in-field /
// label-stacked compositions use the `InputGroup*` family from `./input-group`.
//
// Place INSIDE a wrapping <div class="flex"> alongside an <Input>; the wrapper
// owns the shared border. See examples in the design-system reference doc.

function InputAddon({
  className,
  side = "end",
  ...props
}: React.ComponentProps<"div"> & { side?: "start" | "end" }) {
  return (
    <div
      data-slot="input-addon"
      data-side={side}
      className={cn(
        "flex shrink-0 items-center bg-muted px-3",
        "text-xs font-semibold text-foreground-tertiary",
        side === "start" && "border-r border-border-subtle rounded-l-lg",
        side === "end" && "border-l border-border-subtle rounded-r-lg",
        className,
      )}
      {...props}
    />
  )
}

export { Input, InputAddon }
