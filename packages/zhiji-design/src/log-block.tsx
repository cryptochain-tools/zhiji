import * as React from "react"

import { cn } from "./lib/utils"

/**
 * LogBlock v2.2 redesign:
 *  - Background always dark (#0f1115 light / #000 dark) — log/terminal blocks
 *    are conventionally dark-themed regardless of app theme.
 *  - Foreground: light text (`text-[oklch(.85_0_0)]`) — readable on dark bg.
 *  - Border: `border-border-subtle` instead of `ring-border-subtle`.
 *  - Built-in support for `data-level="info|warn|error|ok"` on inline spans
 *    via `[data-level=…]` selectors (consumers add the attribute themselves).
 *  - tabular-nums on numbers preserved.
 *
 *  Note: This component intentionally uses arbitrary background colors
 *  (#0f1115 / #000) since terminal-style blocks are an exception to the
 *  no-hex rule — they don't follow theme tokens.
 */

type LogBlockProps = React.HTMLAttributes<HTMLPreElement>

function LogBlock({ className, children, ...props }: LogBlockProps) {
  return (
    <pre
      data-slot="log-block"
      // eslint-disable-next-line tailwindcss/no-arbitrary-value -- log block is theme-independent
      className={cn(
        "overflow-auto rounded-lg border border-border-subtle",
        "bg-[#0f1115] dark:bg-black",
        "p-4 font-mono text-xs leading-relaxed tabular-nums",
        "text-[oklch(0.85_0_0)]",
        // Built-in log-level coloring via data attributes on child spans
        "[&_[data-level=info]]:text-[oklch(0.7_0.15_240)]",
        "[&_[data-level=warn]]:text-[oklch(0.78_0.13_75)]",
        "[&_[data-level=error]]:text-[oklch(0.7_0.18_15)]",
        "[&_[data-level=ok]]:text-[oklch(0.78_0.15_155)]",
        "[&_[data-level=ts]]:text-[oklch(0.55_0_0)]",
        "[&_[data-level=path]]:text-[oklch(0.78_0.12_155)] [&_[data-level=path]]:underline",
        className,
      )}
      {...props}
    >
      {children}
    </pre>
  )
}

export { LogBlock }
