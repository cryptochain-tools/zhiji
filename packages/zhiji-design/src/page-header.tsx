import * as React from "react"

import { cn } from "./lib/utils"

/**
 * PageHeader v2.2 redesign:
 *  - NEW `breadcrumb` prop: renders a lightweight breadcrumb trail above the
 *    title (array of strings, last item is the current page in foreground).
 *  - NEW `actions` prop alias kept (was `meta`) for clarity; `meta` still works.
 *  - Description line-height uses `leading-relaxed` for readability.
 */

type PageHeaderProps = React.HTMLAttributes<HTMLElement> & {
  title: React.ReactNode
  description?: React.ReactNode
  /** Breadcrumb trail — e.g. ["工作台", "账户", "量化策略"] */
  breadcrumb?: string[]
  /** Right-hand meta / action area */
  meta?: React.ReactNode
  actions?: React.ReactNode
}

function PageHeader({
  title,
  description,
  breadcrumb,
  meta,
  actions,
  className,
  children,
  ...props
}: PageHeaderProps) {
  const rightSlot = actions ?? meta

  return (
    <header
      data-slot="page-header"
      className={cn(
        "flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:justify-between",
        className
      )}
      {...props}
    >
      <div data-slot="page-header-content" className="min-w-0 space-y-1.5">
        {/* Breadcrumb trail */}
        {breadcrumb && breadcrumb.length > 0 && (
          <nav
            data-slot="page-header-breadcrumb"
            aria-label="breadcrumb"
            className="flex items-center gap-1 text-xs text-foreground-tertiary"
          >
            {breadcrumb.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && (
                  <span aria-hidden="true" className="select-none opacity-50">
                    /
                  </span>
                )}
                <span
                  className={
                    i === breadcrumb.length - 1
                      ? "font-medium text-foreground"
                      : "hover:text-foreground transition-colors duration-fast"
                  }
                >
                  {crumb}
                </span>
              </React.Fragment>
            ))}
          </nav>
        )}

        <h1
          data-slot="page-header-title"
          className="text-h1 font-bold leading-tight tracking-tight text-foreground"
        >
          {title}
        </h1>

        {description && (
          <div
            data-slot="page-header-description"
            className="max-w-3xl text-sm leading-relaxed text-muted-foreground"
          >
            {description}
          </div>
        )}

        {children}
      </div>

      {rightSlot && (
        <div data-slot="page-header-meta" className="shrink-0">
          {rightSlot}
        </div>
      )}
    </header>
  )
}

export { PageHeader }
