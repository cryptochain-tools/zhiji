import { CalendarIcon, ChevronDown } from "lucide-react"
import * as React from "react"

import { cn } from "./lib/utils"

type DatePickerTriggerProps = React.ComponentProps<"button"> & {
  open?: boolean
  selected?: boolean
  placeholder: string
  displayValue?: string
  showIcon?: boolean
}

function DatePickerTrigger({
  open,
  selected,
  placeholder,
  displayValue,
  showIcon = true,
  className,
  ...props
}: DatePickerTriggerProps) {
  return (
    <button
      type="button"
      className={cn(
        "group flex h-10 w-full min-w-0 cursor-pointer items-center justify-between gap-2",
        "rounded-lg border border-input bg-card px-3 py-2 text-left text-base font-medium text-foreground",
        "transition-[border-color,background-color,box-shadow] duration-fast ease-out outline-none",
        "hover:border-ring",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "active:scale-[0.99]",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50",
        "md:h-9 md:text-sm",
        className,
      )}
      {...props}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {showIcon && (
          <CalendarIcon
            className="size-4 shrink-0 text-foreground-tertiary"
            aria-hidden="true"
          />
        )}
        <span className={cn("truncate", !selected && "font-normal text-foreground-tertiary")}>
          {selected ? displayValue : placeholder}
        </span>
      </div>
      <ChevronDown
        className={cn(
          "size-4 shrink-0 text-foreground-tertiary",
          "transition-transform duration-fast ease-out",
          "group-hover:text-foreground",
          open && "rotate-180",
        )}
      />
    </button>
  )
}

export { DatePickerTrigger }
