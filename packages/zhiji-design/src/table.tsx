"use client"

import * as React from "react"

import { cn } from "./lib/utils"

/**
 * Table v2.2 redesign:
 *  - TableHead: uppercase + `text-xs` + `font-semibold` + `text-foreground-tertiary`
 *    — makes column headers clearly distinct from body rows at a glance.
 *  - TableRow selected state: `data-[state=selected]` gets brand-muted bg +
 *    3 px inset brand left bar via `shadow-[inset_3px_0_0_var(--brand)]`.
 *  - Density prop (compact | default | comfortable) unchanged.
 */

function Table({
  className,
  density = "default",
  ...props
}: React.ComponentProps<"table"> & {
  density?: "compact" | "default" | "comfortable"
}) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table
        data-slot="table"
        data-density={density}
        className={cn("group/table w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b [&_tr]:border-border-subtle", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t border-border-subtle bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b border-border-subtle",
        "transition-colors duration-fast ease-out",
        "hover:bg-muted/50",
        "has-aria-expanded:bg-muted/50",
        // Selected: brand-muted bg + 3 px inset left border
        "data-[state=selected]:bg-brand-muted/60",
        "data-[state=selected]:shadow-[inset_3px_0_0_var(--brand)]",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        // Redesign: uppercase + tertiary colour + semibold
        "h-10 px-3 text-left align-middle",
        "text-xs font-semibold uppercase tracking-wide text-foreground-tertiary whitespace-nowrap",
        // Density overrides
        "group-data-[density=compact]/table:h-8 group-data-[density=compact]/table:px-2",
        "group-data-[density=comfortable]/table:h-12 group-data-[density=comfortable]/table:px-4",
        "[&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-3 py-2.5 align-middle whitespace-nowrap",
        "group-data-[density=compact]/table:px-2 group-data-[density=compact]/table:py-1.5",
        "group-data-[density=comfortable]/table:px-4 group-data-[density=comfortable]/table:py-3",
        // Numeric columns
        "data-[numeric=true]:tabular-nums [&[data-numeric]]:tabular-nums",
        "[&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption }
