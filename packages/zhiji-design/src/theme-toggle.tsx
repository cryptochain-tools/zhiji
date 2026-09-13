import { Moon, Sun } from "lucide-react"
import * as React from "react"

import { Button } from "./button"

/**
 * ThemeToggle v2.2 — UI-only theme toggle. The actual theme state is wired
 * by consumers via `isDark` + `onToggle`.
 *
 * Changes from v2.1:
 *  - Uses `variant="ghost"` for less visual weight (theme toggle is
 *    secondary navigation, not a brand action).
 *  - Default aria-label remains "切换主题"; consumers can override.
 *  - Size kept at `icon` (square pill).
 */
type ThemeToggleProps = Omit<
  React.ComponentProps<typeof Button>,
  "onClick" | "children" | "aria-label"
> & {
  isDark: boolean
  onToggle: () => void
  "aria-label"?: string
}

function ThemeToggle({
  isDark,
  onToggle,
  "aria-label": ariaLabel = "切换主题",
  ...props
}: ThemeToggleProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onToggle}
      aria-label={ariaLabel}
      title={ariaLabel}
      {...props}
    >
      {isDark ? (
        <Sun className="h-4 w-4" aria-hidden="true" />
      ) : (
        <Moon className="h-4 w-4" aria-hidden="true" />
      )}
    </Button>
  )
}

export { ThemeToggle }
