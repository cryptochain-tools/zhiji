import * as React from "react"

import { DateTimePicker } from "./date-time-picker"
import { cn } from "./lib/utils"

type DateTimeRangePickerProps = {
  startValue?: string
  endValue?: string
  onStartChange: (value: string) => void
  onEndChange: (value: string) => void
  className?: string
  startLabel?: string
  endLabel?: string
  startPlaceholder?: string
  endPlaceholder?: string
  minuteStep?: number
  disabled?: boolean
}

function DateTimeRangePicker({
  startValue,
  endValue,
  onStartChange,
  onEndChange,
  className,
  startLabel = "开始时间",
  endLabel = "结束时间",
  startPlaceholder = "请选择开始时间",
  endPlaceholder = "请选择结束时间",
  minuteStep,
  disabled,
}: DateTimeRangePickerProps) {
  return (
    <div className={cn("grid gap-3 md:grid-cols-2", className)}>
      <DateTimeRangeField label={startLabel}>
        <DateTimePicker
          value={startValue}
          onChange={onStartChange}
          placeholder={startPlaceholder}
          minuteStep={minuteStep}
          disabled={disabled}
        />
      </DateTimeRangeField>
      <DateTimeRangeField label={endLabel}>
        <DateTimePicker
          value={endValue}
          onChange={onEndChange}
          placeholder={endPlaceholder}
          minuteStep={minuteStep}
          disabled={disabled}
        />
      </DateTimeRangeField>
    </div>
  )
}

function DateTimeRangeField({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="grid min-w-0 gap-1.5">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      {children}
    </label>
  )
}

export { DateTimeRangePicker }
