import dayjs from "dayjs"
import * as React from "react"

import { Button } from "./button"
import { Calendar } from "./calendar"
import { DatePickerTrigger } from "./date-picker-trigger"
import { cn } from "./lib/utils"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

type DateTimePickerProps = {
  value?: string
  onChange: (value: string) => void
  className?: string
  triggerClassName?: string
  placeholder?: string
  showIcon?: boolean
  disabled?: boolean
  minuteStep?: number
  clearLabel?: string
  nowLabel?: string
}

const parseValue = (value?: string) => {
  if (!value) return null
  const parsed = dayjs(value)
  return parsed.isValid() ? parsed : null
}

const normalizeMinuteStep = (value?: number) => {
  if (!value || value < 1 || value > 30) return 1
  return Math.floor(value)
}

const formatValue = (date: dayjs.Dayjs) => date.format("YYYY-MM-DDTHH:mm")

function DateTimePicker({
  value,
  onChange,
  className,
  triggerClassName,
  placeholder = "请选择时间",
  showIcon = true,
  disabled,
  minuteStep = 1,
  clearLabel = "清除",
  nowLabel = "现在",
}: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const selected = parseValue(value)
  const selectedDate = selected?.toDate()
  const step = normalizeMinuteStep(minuteStep)
  const hour = selected?.hour() ?? dayjs().hour()
  const minute = selected?.minute() ?? Math.floor(dayjs().minute() / step) * step
  const minuteOptions = React.useMemo(
    () => Array.from({ length: Math.ceil(60 / step) }, (_, index) => index * step).filter((item) => item < 60),
    [step],
  )

  const commit = (next: dayjs.Dayjs) => {
    onChange(formatValue(next.second(0).millisecond(0)))
  }

  const commitDate = (date: Date) => {
    const next = dayjs(date).hour(hour).minute(minute)
    commit(next)
  }

  const commitHour = (nextHour: number) => {
    const base = selected || dayjs()
    commit(base.hour(nextHour).minute(minute))
  }

  const commitMinute = (nextMinute: number) => {
    const base = selected || dayjs()
    commit(base.hour(hour).minute(nextMinute))
  }

  const commitNow = () => {
    commit(dayjs())
    setOpen(false)
  }

  const clear = () => {
    onChange("")
    setOpen(false)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <DatePickerTrigger
            disabled={disabled}
            open={open}
            selected={Boolean(selected)}
            placeholder={placeholder}
            displayValue={selected ? selected.format("YYYY/MM/DD HH:mm") : undefined}
            showIcon={showIcon}
            className={[className, triggerClassName].filter(Boolean).join(" ")}
            data-slot="date-time-picker-trigger"
          />
        }
      />
      <PopoverContent align="start" className="w-auto p-0">
        <div className="grid gap-0 md:grid-cols-[auto_144px]">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (date) commitDate(date)
            }}
          />
          <div className="grid grid-cols-2 border-t border-border-subtle md:border-l md:border-t-0">
            <TimeColumn
              label="小时"
              values={Array.from({ length: 24 }, (_, index) => index)}
              selected={hour}
              onSelect={commitHour}
            />
            <TimeColumn
              label="分钟"
              values={minuteOptions}
              selected={minute}
              onSelect={commitMinute}
            />
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-border-subtle px-3 py-2">
          <Button variant="link" size="sm" onClick={clear}>
            {clearLabel}
          </Button>
          <Button variant="link" size="sm" onClick={commitNow}>
            {nowLabel}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function TimeColumn({
  label,
  values,
  selected,
  onSelect,
}: {
  label: string
  values: number[]
  selected: number
  onSelect: (value: number) => void
}) {
  const selectedRef = React.useRef<HTMLButtonElement | null>(null)

  React.useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "center" })
  }, [selected])

  return (
    <div className="grid min-w-16 grid-rows-[auto_224px]">
      <div className="border-b border-border-subtle px-2 py-2 text-center text-2xs font-semibold text-foreground-tertiary">
        {label}
      </div>
      <div className="overflow-y-auto p-1">
        {values.map((item) => {
          const active = item === selected
          return (
            <button
              key={item}
              ref={active ? selectedRef : undefined}
              type="button"
              className={cn(
                "mb-1 flex h-8 w-full items-center justify-center rounded-md text-sm font-semibold",
                "transition-colors duration-fast ease-out outline-none",
                "hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50",
                active
                  ? "bg-primary text-primary-foreground hover:bg-primary"
                  : "text-foreground",
              )}
              onClick={() => onSelect(item)}
            >
              {String(item).padStart(2, "0")}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export { DateTimePicker }
