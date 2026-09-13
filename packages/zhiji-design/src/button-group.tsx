import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./lib/utils"

/**
 * ButtonGroup v2.3 — 修 1D 凸出 + vertical 共享边框.
 *  - Horizontal: children share borders (right border removed except on last).
 *  - Vertical: children share borders (bottom border removed except on last).
 *  - ButtonGroupText 强制 `h-9` (匹配 Button default size) —— 旧版没有显式高度,
 *    某些 stretch 场景下会被内容撑高,在 demo 里造成 1D 比相邻 button 高的 bug.
 *  - ButtonGroupSeparator 取消多余 my-px/mx-px 内缩,纯靠 `self-stretch` 撑满高度,
 *    保证视觉 1px 直线与外壳贴合.
 */
const buttonGroupVariants = cva(
  [
    // self-start: 防止外层 flex/grid 容器的 align-items: stretch 把 ButtonGroup 高度
    // 拉伸到兄弟元素的高度。例如水平 group 与 vertical group 并排时,旧版会被拉到
    // vertical 的高度,导致 separator 被 self-stretch 拉伸到几倍 button 高度。
    "flex w-fit self-start items-stretch",
    "*:focus-visible:relative *:focus-visible:z-10",
    "has-[>[data-slot=button-group]]:gap-2",
    "has-[select[aria-hidden=true]:last-child]:[&>[data-slot=select-trigger]:last-of-type]:rounded-r-lg",
    "[&>[data-slot=select-trigger]:not([class*='w-'])]:w-fit",
    "[&>input]:flex-1",
  ].join(" "),
  {
    variants: {
      orientation: {
        horizontal:
          "*:data-slot:rounded-r-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-r-lg! [&>[data-slot]~[data-slot]]:rounded-l-none [&>[data-slot]~[data-slot]]:border-l-0",
        vertical:
          "flex-col *:data-slot:rounded-b-none [&>[data-slot]:not(:has(~[data-slot]))]:rounded-b-lg! [&>[data-slot]~[data-slot]]:rounded-t-none [&>[data-slot]~[data-slot]]:border-t-0",
      },
    },
    defaultVariants: { orientation: "horizontal" },
  }
)

function ButtonGroup({
  className,
  orientation,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof buttonGroupVariants>) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation={orientation}
      className={cn(buttonGroupVariants({ orientation }), className)}
      {...props}
    />
  )
}

function ButtonGroupText({
  className,
  render,
  ...props
}: useRender.ComponentProps<"div">) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          // h-9 (= Button default size) 让 horizontal group 内的文字胶囊与左右 button 等高;
          // border-input 与 outline button 同款边线;text-foreground-tertiary 与 InputAddon 同款字色;
          // shrink-0 防止被相邻 flex-1 input 压扁.
          "flex h-9 shrink-0 items-center gap-2 rounded-lg border border-input bg-muted px-2.5 text-sm font-medium text-foreground-tertiary",
          "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
          className
        ),
      },
      props
    ),
    render,
    state: { slot: "button-group-text" },
  })
}

function ButtonGroupSeparator({
  className,
  orientation = "vertical",
  ...props
}: React.ComponentProps<"div"> & { orientation?: "vertical" | "horizontal" }) {
  // 注:不复用 ./separator (基于 base-ui Separator),因为它内部会强制设置高度,
  // 使我们的 self-stretch / h-9 在 ButtonGroup flex 容器内被覆盖,导致 separator
  // 比相邻 button 高出一截.这里用原生 div 实现,完全由 ButtonGroup 控制尺寸.
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      data-slot="button-group-separator"
      data-orientation={orientation}
      className={cn(
        // bg-input 与 outline button border-input 同色,保证 group 内边线视觉一致
        "shrink-0 bg-input",
        // 垂直分隔线:1px 宽,自适应外壳高度(items-stretch 拉伸到 button h-9)
        "data-[orientation=vertical]:w-px data-[orientation=vertical]:self-stretch",
        // 水平分隔线:1px 高,占满外壳宽度
        "data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full",
        className,
      )}
      {...props}
    />
  )
}

export { ButtonGroup, ButtonGroupSeparator, ButtonGroupText, buttonGroupVariants }
