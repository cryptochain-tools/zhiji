import {
  Column,
  ColumnDef,
  Row,
  SortingState,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowData,
  useReactTable,
} from "@tanstack/react-table"
import { ArrowDown, ArrowUp, ArrowUpDown, Inbox } from "lucide-react"
import * as React from "react"

import { Button } from "./button"
import { cn } from "./lib/utils"
import { Skeleton } from "./skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"

/**
 * DataTable v2.2 redesign:
 *  - Sort header: `text-brand-text` (was already brand). Sort icon active —
 *    `text-brand-text`; inactive — `text-foreground-tertiary` (was muted-fg).
 *  - Loading skeleton uses redesigned <Skeleton> with shimmer effect (was
 *    inline animate-pulse div).
 *  - Empty state icon: `text-foreground-tertiary` (was muted-fg) for hierarchy.
 *  - Pagination footer: `border-t border-border-subtle bg-muted/60`.
 */

type StickyColumnConfig = { left?: string[]; right?: string[] }
type DataTableMobileMode = "auto" | "table" | "cards"
type DataTableMobileCardConfig = {
  title?: string
  subtitle?: string
  meta?: string[]
  status?: string
  actions?: string[]
  hidden?: string[]
}

type DataTableProps<TData extends RowData, TValue> = {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  loading?: boolean
  pageSize?: number
  emptyText?: string
  className?: string
  minWidth?: number | string
  maxBodyHeight?: number | string
  stickyColumns?: StickyColumnConfig
  stickyHeader?: boolean
  mobileColumnScale?: number
  enableSorting?: boolean
  surface?: "default" | "card" | "plain"
  surfaceClassName?: string
  density?: "default" | "compact"
  fillHeight?: boolean
  skeletonRowCount?: number
  rowHover?: boolean
  tableLayout?: "auto" | "fixed"
  mobileMode?: DataTableMobileMode
  mobileCard?: DataTableMobileCardConfig
  renderMobileRow?: (input: {
    row: Row<TData>
    original: TData
    columns: Column<TData, unknown>[]
  }) => React.ReactNode
}

function DataTable<TData extends RowData, TValue>({
  columns,
  data,
  loading = false,
  pageSize = 20,
  emptyText = "暂无数据",
  className,
  minWidth,
  maxBodyHeight,
  stickyColumns,
  stickyHeader = false,
  mobileColumnScale = 0.65,
  enableSorting = false,
  surface = "default",
  surfaceClassName = "bg-card",
  density = "default",
  fillHeight = false,
  skeletonRowCount = 3,
  rowHover = true,
  tableLayout = "auto",
  mobileMode = "table",
  mobileCard,
  renderMobileRow,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = React.useState<SortingState>([])
  const scrollRef = React.useRef<HTMLDivElement | null>(null)
  const [{ hasHorizontalOverflow, canScrollLeft, canScrollRight }, setScrollState] = React.useState({
    hasHorizontalOverflow: false,
    canScrollLeft: false,
    canScrollRight: false,
  })
  const isMobile = useIsMobile()
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    enableSorting,
    initialState: { pagination: { pageSize } },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
  })
  const visibleColumns = table.getVisibleLeafColumns()
  const columnScale = isMobile ? mobileColumnScale : 1
  const columnSizeMap = React.useMemo(
    () =>
      Object.fromEntries(
        visibleColumns.map((column) => [
          column.id,
          Math.max(56, Math.round(column.getSize() * columnScale)),
        ])
      ),
    [columnScale, visibleColumns]
  )
  const getColumnSize = React.useCallback(
    (columnId: string, fallbackSize: number) =>
      columnSizeMap[columnId] ?? Math.max(56, Math.round(fallbackSize * columnScale)),
    [columnScale, columnSizeMap]
  )
  const tableMinWidth =
    typeof minWidth === "number" && isMobile ? Math.round(minWidth * columnScale) : minWidth
  const pageCount = table.getPageCount() || 1
  const showPagination = pageCount > 1
  const loadingRowCount = Math.max(1, skeletonRowCount)
  const mobileCardConfig = React.useMemo(
    () => resolveMobileCardConfig(visibleColumns, mobileCard),
    [mobileCard, visibleColumns]
  )
  const resolvedMobileMode = React.useMemo(
    () =>
      mobileMode === "auto"
        ? inferMobileMode({ columns: visibleColumns, enableSorting, minWidth })
        : mobileMode,
    [enableSorting, minWidth, mobileMode, visibleColumns]
  )
  const useMobileCards = isMobile && resolvedMobileMode === "cards"
  const surfaceClassMap = {
    default: "min-w-0 overflow-hidden rounded-lg border border-border-subtle shadow-card",
    card: "min-w-0 overflow-hidden rounded-none border-0 shadow-none",
    plain: "min-w-0 overflow-hidden rounded-none border-0 bg-transparent shadow-none",
  } as const

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
  }, [data.length, visibleColumns.length, isMobile, mobileColumnScale, minWidth])

  const stickyOffsetMap = React.useMemo(() => {
    const offsets: Record<"left" | "right", Record<string, number>> = { left: {}, right: {} }
    const leftIds = stickyColumns?.left || []
    leftIds.reduce((offset, id) => {
      offsets.left[id] = offset
      return offset + (columnSizeMap[id] || 0)
    }, 0)
    const rightIds = stickyColumns?.right || []
    rightIds.reduceRight((offset, id) => {
      offsets.right[id] = offset
      return offset + (columnSizeMap[id] || 0)
    }, 0)
    return offsets
  }, [columnSizeMap, stickyColumns?.left, stickyColumns?.right])

  const getColumnOffset = (columnId: string, side: "left" | "right") => {
    if (!stickyColumns?.[side]?.includes(columnId)) return undefined
    return stickyOffsetMap[side][columnId] ?? 0
  }

  const getStickyClassName = (columnId: string, side: "left" | "right", isHeader = false) => {
    const stickyIds = stickyColumns?.[side] || []
    if (!stickyIds.includes(columnId)) return ""
    return cn(
      "sticky",
      surfaceClassName,
      isHeader ? "z-30" : "z-[1]",
      hasHorizontalOverflow &&
        side === "left" &&
        canScrollLeft &&
        columnId === stickyIds[stickyIds.length - 1] &&
        "shadow-[8px_0_12px_-12px_rgba(0,0,0,.7)]",
      hasHorizontalOverflow &&
        side === "right" &&
        canScrollRight &&
        columnId === stickyIds[0] &&
        "shadow-[-8px_0_12px_-12px_rgba(0,0,0,.7)]"
    )
  }

  const getStickyStyle = (columnId: string, side: "left" | "right") => {
    const offset = getColumnOffset(columnId, side)
    if (offset === undefined) return {}
    return { [side]: offset }
  }

  return (
    <div
      className={cn(
        surfaceClassMap[surface],
        fillHeight && "flex h-full flex-col",
        surface !== "plain" && surfaceClassName,
        className
      )}
    >
      {useMobileCards ? (
        <MobileCardList
          columns={visibleColumns}
          emptyText={emptyText}
          loading={loading}
          loadingRowCount={loadingRowCount}
          renderMobileRow={renderMobileRow}
          rows={table.getRowModel().rows}
          config={mobileCardConfig}
        />
      ) : (
        <div
          ref={scrollRef}
          className={cn("max-w-full overflow-auto", fillHeight && "min-h-0 flex-1")}
          style={{ maxHeight: maxBodyHeight }}
        >
          <Table
            density={density}
            style={{
              minWidth: tableMinWidth,
              height: fillHeight ? "100%" : undefined,
              tableLayout,
            }}
          >
            <colgroup>
              {visibleColumns.map((column) => (
                <col
                  key={column.id}
                  style={{ width: getColumnSize(column.id, column.getSize()) }}
                />
              ))}
            </colgroup>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => {
                    const sortState = header.column.getIsSorted()
                    const columnId = header.column.id
                    return (
                      <TableHead
                        key={header.id}
                        className={cn(
                          "whitespace-nowrap",
                          density === "compact" && "h-9 px-3 text-2xs",
                          surfaceClassName,
                          stickyHeader && "sticky top-0 z-20",
                          getStickyClassName(columnId, "left", true),
                          getStickyClassName(columnId, "right", true)
                        )}
                        style={{
                          width: getColumnSize(columnId, header.getSize()),
                          ...getStickyStyle(columnId, "left"),
                          ...getStickyStyle(columnId, "right"),
                        }}
                      >
                        {header.isPlaceholder ? null : (
                          <button
                            type="button"
                            className={cn(
                              "inline-flex items-center gap-1 rounded-sm text-left",
                              "transition-colors duration-fast ease-out",
                              "focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                              "active:scale-[0.99]",
                              "disabled:cursor-default disabled:opacity-70",
                              header.column.getCanSort() && "cursor-pointer hover:text-brand-text"
                            )}
                            disabled={!header.column.getCanSort()}
                            onClick={header.column.getToggleSortingHandler()}
                          >
                            {flexRender(header.column.columnDef.header, header.getContext())}
                            {header.column.getCanSort() && (
                              <>
                                {sortState === "asc" && (
                                  <ArrowUp className="size-3.5 text-brand-text" />
                                )}
                                {sortState === "desc" && (
                                  <ArrowDown className="size-3.5 text-brand-text" />
                                )}
                                {!sortState && (
                                  <ArrowUpDown className="size-3.5 text-foreground-tertiary" />
                                )}
                              </>
                            )}
                          </button>
                        )}
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {loading ? (
                Array.from({ length: loadingRowCount }, (_, rowIndex) => (
                  <TableRow
                    key={`skeleton-${rowIndex}`}
                    className="hover:bg-transparent"
                  >
                    {visibleColumns.map((column, columnIndex) => {
                      const columnId = column.id
                      return (
                        <TableCell
                          key={`${columnId}-skeleton-${rowIndex}`}
                          className={cn(
                            "overflow-hidden",
                            density === "compact" && "h-11 px-3",
                            surfaceClassName,
                            getStickyClassName(columnId, "left"),
                            getStickyClassName(columnId, "right")
                          )}
                          style={{
                            width: getColumnSize(columnId, column.getSize()),
                            ...getStickyStyle(columnId, "left"),
                            ...getStickyStyle(columnId, "right"),
                          }}
                        >
                          <Skeleton
                            className={cn(
                              "h-4",
                              columnIndex === 0 && "w-2/3",
                              columnIndex > 0 && columnIndex < visibleColumns.length - 1 && "w-3/4",
                              columnIndex === visibleColumns.length - 1 && "w-1/2"
                            )}
                          />
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))
              ) : table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={!rowHover ? "hover:bg-transparent" : undefined}
                  >
                    {row.getVisibleCells().map((cell) => {
                      const columnId = cell.column.id
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            "overflow-hidden",
                            density === "compact" && "h-11 px-3",
                            surfaceClassName,
                            getStickyClassName(columnId, "left"),
                            getStickyClassName(columnId, "right")
                          )}
                          style={{
                            width: getColumnSize(columnId, cell.column.getSize()),
                            ...getStickyStyle(columnId, "left"),
                            ...getStickyStyle(columnId, "right"),
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      )
                    })}
                  </TableRow>
                ))
              ) : (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={columns.length} className="h-32 text-center">
                    <div className="flex flex-col items-center gap-2 text-foreground-tertiary">
                      <Inbox className="size-7" />
                      <span>{emptyText}</span>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
      {showPagination ? (
        <div className="flex items-center justify-between border-t border-border-subtle bg-muted/60 px-4 py-3 text-sm text-muted-foreground">
          <span>
            第 {table.getState().pagination.pageIndex + 1} / {pageCount} 页
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              上一页
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              下一页
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

const titleColumnCandidates = ["name", "username", "alias", "symbol", "taskKey", "baseCoin"]
const subtitleColumnCandidates = ["remark", "description"]
const statusColumnCandidates = ["status", "state"]
const actionColumnCandidates = ["action", "actions", "api", "login", "detail"]

function inferMobileMode<TData extends RowData>({
  columns,
  enableSorting,
  minWidth,
}: {
  columns: Column<TData, unknown>[]
  enableSorting: boolean
  minWidth?: number | string
}): DataTableMobileMode {
  if (enableSorting) return "table"
  if (typeof minWidth === "number" && minWidth >= 1000) return "table"

  const columnIds = columns.map((column) => column.id)
  const hasActionColumn = columnIds.some((id) => actionColumnCandidates.includes(id))
  const hasTitleColumn = columnIds.some((id) => titleColumnCandidates.includes(id))

  if (hasActionColumn && columns.length <= 8) return "cards"
  if (hasTitleColumn && columns.length <= 7) return "cards"
  return "table"
}

function resolveMobileCardConfig<TData extends RowData>(
  columns: Column<TData, unknown>[],
  config?: DataTableMobileCardConfig
) {
  const columnIds = columns.map((column) => column.id)
  const pick = (candidates: string[]) => candidates.find((id) => columnIds.includes(id))
  const actions = config?.actions ?? columnIds.filter((id) => actionColumnCandidates.includes(id))

  return {
    title: config?.title ?? pick(titleColumnCandidates) ?? columnIds.find((id) => id !== "id") ?? columnIds[0],
    subtitle: config?.subtitle ?? pick(subtitleColumnCandidates),
    status: config?.status ?? pick(statusColumnCandidates),
    meta: config?.meta,
    actions,
    hidden: config?.hidden ?? [],
  }
}

function getHeaderLabel<TData extends RowData>(column: Column<TData, unknown>) {
  const header = column.columnDef.header
  return typeof header === "string" ? header : column.id
}

function MobileCardList<TData extends RowData>({
  columns,
  config,
  emptyText,
  loading,
  loadingRowCount,
  renderMobileRow,
  rows,
}: {
  columns: Column<TData, unknown>[]
  config: ReturnType<typeof resolveMobileCardConfig<TData>>
  emptyText: string
  loading: boolean
  loadingRowCount: number
  renderMobileRow?: DataTableProps<TData, unknown>["renderMobileRow"]
  rows: Row<TData>[]
}) {
  if (loading) {
    return (
      <div className="divide-y divide-border-subtle">
        {Array.from({ length: loadingRowCount }, (_, index) => (
          <div key={`mobile-card-skeleton-${index}`} className="grid gap-3 px-4 py-4">
            <div className="flex items-start justify-between gap-4">
              <div className="grid min-w-0 flex-1 gap-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
              <Skeleton className="h-5 w-14 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-3 w-4/5" />
              <Skeleton className="h-3 w-3/5" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-8 w-16 rounded-md" />
              <Skeleton className="h-8 w-16 rounded-md" />
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (!rows.length) {
    return (
      <div className="flex min-h-32 flex-col items-center justify-center gap-2 px-4 py-10 text-center text-sm text-foreground-tertiary">
        <Inbox className="size-7" />
        <span>{emptyText}</span>
      </div>
    )
  }

  return (
    <div className="divide-y divide-border-subtle">
      {rows.map((row) => {
        if (renderMobileRow) {
          return (
            <div key={row.id} className="px-4 py-3.5">
              {renderMobileRow({ row, original: row.original, columns })}
            </div>
          )
        }

        const cellMap = Object.fromEntries(row.getVisibleCells().map((cell) => [cell.column.id, cell]))
        const consumedIds = new Set([
          config.title,
          config.subtitle,
          config.status,
          ...config.actions,
          ...config.hidden,
        ].filter(Boolean) as string[])
        const metaIds = config.meta ?? columns.map((column) => column.id).filter((id) => !consumedIds.has(id))
        const titleCell = config.title ? cellMap[config.title] : undefined
        const subtitleCell = config.subtitle ? cellMap[config.subtitle] : undefined
        const statusCell = config.status ? cellMap[config.status] : undefined
        const actionCells = config.actions.map((id) => cellMap[id]).filter(Boolean)

        return (
          <div key={row.id} className="grid gap-3 px-4 py-3.5">
            <div className="flex min-w-0 items-start justify-between gap-3">
              <div className="grid min-w-0 flex-1 gap-1">
                <div className="min-w-0 truncate text-base font-semibold leading-6 text-foreground">
                  {titleCell ? flexRender(titleCell.column.columnDef.cell, titleCell.getContext()) : "--"}
                </div>
                {subtitleCell ? (
                  <div className="min-w-0 truncate text-sm leading-5 text-muted-foreground">
                    {flexRender(subtitleCell.column.columnDef.cell, subtitleCell.getContext())}
                  </div>
                ) : null}
              </div>
              {statusCell ? (
                <div className="shrink-0 pt-0.5">
                  {flexRender(statusCell.column.columnDef.cell, statusCell.getContext())}
                </div>
              ) : null}
            </div>

            {metaIds.length ? (
              <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {metaIds.map((id, index) => {
                  const cell = cellMap[id]
                  if (!cell) return null
                  return (
                    <div
                      key={id}
                      className={cn(
                        "grid min-w-0 gap-0.5",
                        index % 2 === 1 && "justify-items-end text-right"
                      )}
                    >
                      <span className="truncate text-xs font-semibold text-foreground-tertiary">
                        {getHeaderLabel(cell.column)}
                      </span>
                      <div className="min-w-0 truncate text-sm leading-5 text-foreground">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : null}

            {actionCells.length ? (
              <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 pt-1">
                {actionCells.map((cell) => (
                  <React.Fragment key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </React.Fragment>
                ))}
              </div>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState(false)
  React.useEffect(() => {
    const query = window.matchMedia("(max-width: 767px)")
    const update = () => setIsMobile(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return isMobile
}

export { DataTable, type DataTableProps }
