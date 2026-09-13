import { Slider as SliderPrimitive } from "@base-ui/react/slider"

import { cn } from "./lib/utils"

/**
 * Slider v2.2 redesign:
 *  - Thumb border: `border-brand` (explicit brand token) for clear affordance.
 *  - Thumb shadow: `shadow-[0_1px_4px_rgba(0,0,0,.18)]` — matches Switch thumb.
 *  - Thumb bg: `bg-card` (white/dark-card) so it reads on both light/dark track.
 *  - Hover/focus ring: `ring-ring/50` (brand-derived) for brand consistency.
 *  - Track height increased to `h-1.5` (6 px) default — easier to click.
 */
function Slider({
  className,
  defaultValue,
  value,
  min = 0,
  max = 100,
  onValueChange,
  onValuesChange,
  ...props
}: Omit<SliderPrimitive.Root.Props, "onValueChange"> & {
  onValueChange?: (value: number) => void
  onValuesChange?: (value: number[]) => void
}) {
  const _values = Array.isArray(value)
    ? value
    : Array.isArray(defaultValue)
      ? defaultValue
      : [min, max]

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn("data-horizontal:w-full data-vertical:h-full", className)}
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      onValueChange={(nextValue) => {
        const values = Array.isArray(nextValue) ? nextValue : [nextValue]
        onValueChange?.(values[0])
        onValuesChange?.(values)
      }}
      thumbAlignment="edge"
      {...props}
    >
      <SliderPrimitive.Control className="relative flex w-full touch-none items-center select-none data-disabled:opacity-50 data-vertical:h-full data-vertical:min-h-40 data-vertical:w-auto data-vertical:flex-col">
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative grow overflow-hidden rounded-full bg-muted select-none data-horizontal:h-1.5 data-horizontal:w-full data-vertical:h-full data-vertical:w-1.5"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-range"
            className="bg-primary transition-[width,height,background-color] duration-fast ease-out select-none data-horizontal:h-full data-vertical:w-full"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: _values.length }, (_, index) => (
          <SliderPrimitive.Thumb
            data-slot="slider-thumb"
            key={index}
            className={cn(
              "relative block size-4 shrink-0 rounded-full",
              "border-[1.5px] border-brand bg-card",
              // Drop shadow matching Switch
              "shadow-[0_1px_4px_rgba(0,0,0,.18)]",
              "transition-[color,box-shadow] duration-fast ease-out select-none",
              "after:absolute after:-inset-2",
              "hover:ring-3 hover:ring-ring/50",
              "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-hidden",
              "active:ring-3 active:ring-ring/50",
              "disabled:pointer-events-none disabled:opacity-50",
            )}
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
