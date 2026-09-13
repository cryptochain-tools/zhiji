import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Textarea v2.3 redesign:
 *  - Default background `bg-card`（亮=白 / 暗=深 card），与 Input v2.4 一致，
 *    对齐 packages/design/CLAUDE.md 第 9 条。
 *  - Focus glow `ring-3 ring-ring/50 border-ring`（不再做 bg-card 抬升，原本就是 bg-card）。
 *  - `field-sizing-content` 保留用于自动撑高。
 *  - iOS zoom prevention: `text-base md:text-sm` 保留。
 *  - v2.3: 清理 `dark:bg-input/30` / `dark:focus-visible:bg-card` /
 *    `dark:disabled:bg-input/80` 等基于 input alpha 叠加的暗色补丁，全部走 `bg-card` /
 *    `bg-muted` token。
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-28 w-full rounded-lg border border-input bg-card",
        "px-3 py-2 text-base leading-relaxed",
        "placeholder:text-foreground-tertiary placeholder:font-normal",
        "transition-[border-color,background-color,box-shadow] duration-fast ease-out outline-none",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20",
        // iOS zoom prevention
        "md:text-sm",
        // Dark — invalid ring only; bg-card handles light/dark automatically
        "dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
