import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "./lib/utils"

/**
 * Tabs v2.2 redesign:
 *  - `line` variant: active trigger uses a `scaleX` CSS transform on the
 *    ::after underline (via `data-active:after:scale-x-100`) — more dynamic
 *    than the static opacity switch used in v2.1.
 *  - NEW `pill` variant: independent rounded-pill triggers, no shared bg
 *    container — great for filter bars and category selectors.
 *  - `default` variant (segmented control) unchanged.
 */

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-2 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center justify-center group-data-horizontal/tabs:h-fit",
  {
    variants: {
      variant: {
        default:
          "gap-1 rounded-lg bg-muted p-1 group-data-horizontal/tabs:h-10 group-data-vertical/tabs:flex-col",
        line:
          "gap-0 rounded-none border-b border-border bg-transparent group-data-vertical/tabs:flex-col group-data-vertical/tabs:border-b-0 group-data-vertical/tabs:border-r",
        pill:
          "gap-1.5 rounded-none bg-transparent",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        // ── shared base ──────────────────────────────────────────────────────
        "relative inline-flex items-center justify-center gap-1.5 border border-transparent",
        "text-sm font-semibold whitespace-nowrap text-foreground/60",
        "transition-colors duration-fast ease-out outline-none",
        "group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start",
        "hover:text-foreground",
        "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        "disabled:pointer-events-none disabled:opacity-50",
        "aria-disabled:pointer-events-none aria-disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",

        // ── default variant (segmented control) ──────────────────────────────
        "group-data-[variant=default]/tabs-list:h-[calc(100%-1px)] group-data-[variant=default]/tabs-list:flex-1",
        "group-data-[variant=default]/tabs-list:rounded-md group-data-[variant=default]/tabs-list:px-2 group-data-[variant=default]/tabs-list:py-0.5",
        "group-data-[variant=default]/tabs-list:data-active:bg-card",
        "group-data-[variant=default]/tabs-list:data-active:text-brand-text",
        "group-data-[variant=default]/tabs-list:data-active:border-brand/30",
        "group-data-[variant=default]/tabs-list:data-active:shadow-sm",

        // ── line variant (underline) ─────────────────────────────────────────
        "group-data-[variant=line]/tabs-list:rounded-none group-data-[variant=line]/tabs-list:px-3.5 group-data-[variant=line]/tabs-list:py-2",
        "group-data-[variant=line]/tabs-list:border-0",
        // Underline element (scales in on active)
        "group-data-[variant=line]/tabs-list:after:absolute",
        "group-data-[variant=line]/tabs-list:after:inset-x-0 group-data-[variant=line]/tabs-list:after:-bottom-px",
        "group-data-[variant=line]/tabs-list:after:h-[2px] group-data-[variant=line]/tabs-list:after:rounded-t-sm",
        "group-data-[variant=line]/tabs-list:after:bg-brand",
        "group-data-[variant=line]/tabs-list:after:scale-x-0 group-data-[variant=line]/tabs-list:after:origin-left",
        "group-data-[variant=line]/tabs-list:after:transition-transform group-data-[variant=line]/tabs-list:after:duration-fast group-data-[variant=line]/tabs-list:after:ease-out",
        "group-data-[variant=line]/tabs-list:data-active:text-brand-text group-data-[variant=line]/tabs-list:data-active:font-semibold",
        "group-data-[variant=line]/tabs-list:data-active:after:scale-x-100",

        // ── pill variant ─────────────────────────────────────────────────────
        "group-data-[variant=pill]/tabs-list:rounded-full group-data-[variant=pill]/tabs-list:px-3.5 group-data-[variant=pill]/tabs-list:py-1",
        "group-data-[variant=pill]/tabs-list:text-muted-foreground",
        "group-data-[variant=pill]/tabs-list:data-active:bg-brand-muted",
        "group-data-[variant=pill]/tabs-list:data-active:text-brand-text",
        "group-data-[variant=pill]/tabs-list:data-active:border-brand/30",

        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn("flex-1 text-sm outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
