import * as React from "react"

import { Skeleton } from "./skeleton"
import { cn } from "./lib/utils"

/**
 * FixedEdgeScrollTable v2.2 redesign:
 *  - Header text: `text-foreground-tertiary` + `font-semibold + uppercase`
 *    (matches Table v2.2 header styling).
 *  - Sticky shadow strengthened: `shadow-[8px_0_16px_-8px_rgba(15,17,21,.18)]`
 *    softer + slightly wider — more refined than the old harsh shadow.
 *  - Loading skeletons use redesigned <Skeleton> (shimmer effect).
 *  - Row hover: `hover:bg-muted/60` (was active:bg-muted — hover is more
 *    universal across desktop and touch).
 */

export type FixedEdgeScrollTableColumn<TData> = {
  id: string
  header: React.ReactNode
  cell: (row: TData, index: number) => React.ReactNode
  className?: string
  headerClassName?: string
  skeletonClassName?: string
}

export type FixedEdgeScrollTableProps<TData> = {
  rows: TData[]
  getRowKey: (row: TData, index: number) => React.Key
  centerColumns: FixedEdgeScrollTableColumn<TData>[]
  leftColumns?: FixedEdgeScrollTableColumn<TData>[]
  rightColumns?: FixedEdgeScrollTableColumn<TData>[]
  loading?: boolean
  skeletonRowCount?: number
  className?: string
  scrollAreaClassName?: string
  centerMinWidthClassName: string
  centerGridClassName: string
  leftWidthClassName?: string
  leftGridClassName?: string
  rightWidthClassName?: string
  rightGridClassName?: string
  headerHeightClassName?: string
  rowHeightClassName?: string
  surfaceClassName?: string
  getRowIndicator?: (row: TData, index: number) => React.ReactNode
}

const defaultHeaderHeightClassName = "h-9"
const defaultRowHeightClassName = "h-14"

function FixedEdgeScrollTable<TData>({
  rows,
  getRowKey,
  centerColumns,
  leftColumns = [],
  rightColumns = [],
  loading = false,
  skeletonRowCount = 6,
  className,
  scrollAreaClassName,
  centerMinWidthClassName,
  centerGridClassName,
  leftWidthClassName,
  leftGridClassName,
  rightWidthClassName,
  rightGridClassName,
  headerHeightClassName = defaultHeaderHeightClassName,
  rowHeightClassName = defaultRowHeightClassName,
  surfaceClassName = "bg-surface",
  getRowIndicator,
}: FixedEdgeScrollTableProps<TData>) {
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [{ hasHorizontalOverflow, canScrollLeft, canScrollRight }, setScrollState] =
    React.useState({
      hasHorizontalOverflow: false,
      canScrollLeft: false,
      canScrollRight: false,
    })
  const hasLeft = leftColumns.length > 0
  const hasRight = rightColumns.length > 0
  const rowsToRender = loading
    ? Array.from({ length: Math.max(1, skeletonRowCount) })
    : rows

  React.useEffect(() => {
    const element = scrollRef.current
    if (!element) return

    const updateScrollState = () => {
      const maxScrollLeft = element.scrollWidth - element.clientWidth
      const hasOverflow = maxScrollLeft > 1
      const scrollLeft = element.scrollLeft
      setScrollState({
        hasHorizontalOverflow: hasOverflow,
        canScrollLeft: hasOverflow && scrollLeft > 1,
        canScrollRight: hasOverflow && scrollLeft < maxScrollLeft - 1,
      })
    }

    updateScrollState()
    element.addEventListener("scroll", updateScrollState, { passive: true })
    const resizeObserver = new ResizeObserver(updateScrollState)
    resizeObserver.observe(element)

    return () => {
      element.removeEventListener("scroll", updateScrollState)
      resizeObserver.disconnect()
    }
  }, [
    rows.length,
    loading,
    centerColumns.length,
    leftColumns.length,
    rightColumns.length,
    centerMinWidthClassName,
    centerGridClassName,
    leftWidthClassName,
    rightWidthClassName,
  ])

  const renderHeader = (
    columns: FixedEdgeScrollTableColumn<TData>[],
    gridClassName?: string
  ) => (
    <div
      className={cn(
        "grid items-center border-b border-border-subtle",
        "text-2xs font-semibold uppercase tracking-wide text-foreground-tertiary",
        headerHeightClassName,
        gridClassName
      )}
    >
      {columns.map((column) => (
        <div
          key={column.id}
          className={cn("h-full px-3 py-2", column.headerClassName)}
        >
          {column.header}
        </div>
      ))}
    </div>
  )

  const renderSkeletonRow = (
    columns: FixedEdgeScrollTableColumn<TData>[],
    gridClassName: string | undefined,
    side: "left" | "center" | "right",
    rowIndex: number
  ) => (
    <div
      key={`${side}-skeleton-${rowIndex}`}
      className={cn(
        "grid items-center border-b border-border-subtle last:border-b-0",
        rowHeightClassName,
        gridClassName
      )}
    >
      {columns.map((column) => (
        <div key={column.id} className={cn("px-3", column.className)}>
          <Skeleton className={cn("h-4 w-16", column.skeletonClassName)} />
        </div>
      ))}
    </div>
  )

  const renderDataRow = (
    row: TData,
    index: number,
    columns: FixedEdgeScrollTableColumn<TData>[],
    gridClassName: string | undefined,
    side: "left" | "center" | "right"
  ) => (
    <div
      key={`${side}-${String(getRowKey(row, index))}`}
      className={cn(
        "relative grid items-center border-b border-border-subtle last:border-b-0",
        "transition-colors duration-fast ease-out",
        "hover:bg-muted/60 active:bg-muted",
        rowHeightClassName,
        gridClassName
      )}
    >
      {side === "left" ? getRowIndicator?.(row, index) : null}
      {columns.map((column) => (
        <div key={column.id} className={cn("px-3", column.className)}>
          {column.cell(row, index)}
        </div>
      ))}
    </div>
  )

  return (
    <div className={cn("relative isolate", className)}>
      <div
        ref={scrollRef}
        className={cn("overflow-x-auto overscroll-x-contain", scrollAreaClassName)}
      >
        <div className={cn("font-mono", centerMinWidthClassName)}>
          {renderHeader(centerColumns, centerGridClassName)}
          {rowsToRender.map((row, index) =>
            loading
              ? renderSkeletonRow(centerColumns, centerGridClassName, "center", index)
              : renderDataRow(row as TData, index, centerColumns, centerGridClassName, "center")
          )}
        </div>
      </div>

      {hasLeft && leftWidthClassName && leftGridClassName ? (
        <div
          className={cn(
            "absolute left-0 top-0 z-10 font-mono",
            hasHorizontalOverflow &&
              canScrollLeft &&
              "shadow-[8px_0_16px_-8px_rgba(15,17,21,.18)]",
            surfaceClassName,
            leftWidthClassName
          )}
        >
          {renderHeader(leftColumns, leftGridClassName)}
          {rowsToRender.map((row, index) =>
            loading
              ? renderSkeletonRow(leftColumns, leftGridClassName, "left", index)
              : renderDataRow(row as TData, index, leftColumns, leftGridClassName, "left")
          )}
        </div>
      ) : null}

      {hasRight && rightWidthClassName && rightGridClassName ? (
        <div
          className={cn(
            "absolute right-0 top-0 z-10 font-mono",
            hasHorizontalOverflow &&
              canScrollRight &&
              "shadow-[-8px_0_16px_-8px_rgba(15,17,21,.18)]",
            surfaceClassName,
            rightWidthClassName
          )}
        >
          {renderHeader(rightColumns, rightGridClassName)}
          {rowsToRender.map((row, index) =>
            loading
              ? renderSkeletonRow(rightColumns, rightGridClassName, "right", index)
              : renderDataRow(row as TData, index, rightColumns, rightGridClassName, "right")
          )}
        </div>
      ) : null}
    </div>
  )
}

export { FixedEdgeScrollTable }
