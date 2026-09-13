"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon } from "lucide-react"

import { Spinner } from "./spinner"

/**
 * Sonner / Toaster v2.2 redesign:
 *  - Loading icon: replaced Loader2Icon with branded `<Spinner size="sm" />`.
 *  - Bound tokens via CSS vars: `--normal-bg → --popover`, `--border → --border-subtle`,
 *    `--border-radius → --radius` (already mapped — unchanged but documented).
 *  - Icons standardized at `size-4` (16 px) and use semantic colors via CSS
 *    on the toast container (Sonner consumers can target `[data-type=success]`
 *    etc. for left-accent-bar styling consistent with Alert).
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4 text-bull" />,
        info:    <InfoIcon className="size-4 text-info" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error:   <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Spinner size="sm" tone="brand" />,
      }}
      style={
        {
          "--normal-bg":     "var(--popover)",
          "--normal-text":   "var(--popover-foreground)",
          "--normal-border": "var(--border-subtle)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
