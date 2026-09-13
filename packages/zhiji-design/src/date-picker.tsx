import dayjs from "dayjs"
import * as React from "react"

import { Calendar } from "./calendar"
import { DatePickerTrigger } from "./date-picker-trigger"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

/**
 * DatePicker v2.2 redesign:
 *  - Trigger surface: `bg-card` (was already bg-card, kept). Border: `border-input`.
 *  - Trigger focus: `ring-3 ring-ring/50` (was ring-1) — matches Input v2.2.
 *  - Placeholder: `text-foreground-tertiary`.
 *  - Added optional leading CalendarIcon to make the affordance clearer.
 *  - Chevron rotates 180° on open (already in v2.1 — preserved).
 */

type DatePickerProps = {
  value: string
  onChange: (value: string) => void
  className?: string
  triggerClassName?: string
  placeholder?: string
  showIcon?: boolean
}

function DatePicker({
  value,
  onChange,
  className,
  triggerClassName,
  placeholder = "选择日期",
  showIcon = true,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = value ? dayjs(value).toDate() : undefined

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <DatePickerTrigger
            open={open}
            selected={Boolean(selected)}
            placeholder={placeholder}
            displayValue={selected ? dayjs(selected).format("YYYY/MM/DD") : undefined}
            showIcon={showIcon}
            className={[className, triggerClassName].filter(Boolean).join(" ")}
            data-slot="date-picker-trigger"
          />
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (date) {
              onChange(dayjs(date).format("YYYY-MM-DD"))
              setOpen(false)
            }
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

export { DatePicker }
