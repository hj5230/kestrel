import { useEffect, useRef, useState } from "preact/hooks"
import { cn } from "cn"

/**
 * Single-thumb slider on a native range input. Radix's slider registers its thumbs through a
 * collection that does not resolve under preact/compat, which left the thumb hidden (and the
 * value frozen while dragging). The native control also renders as the system slider on iOS.
 * Keeps the array-valued API of the kit component it replaces.
 */
function Slider({
  className,
  value,
  defaultValue,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  onValueChange,
  onValueCommit,
}: {
  className?: string
  value?: number[]
  defaultValue?: number[]
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  onValueChange?: (value: number[]) => void
  /** Called once the user lets go (native `change`), not on every step of a drag. */
  onValueCommit?: (value: number[]) => void
}) {
  const [current, setCurrent] = useState((value ?? defaultValue ?? [min])[0])
  const external = value?.[0]
  useEffect(() => {
    if (external !== undefined) setCurrent(external)
  }, [external])

  // preact/compat maps onChange to the input event, so listen for the real commit natively.
  const ref = useRef<HTMLInputElement>(null)
  const commit = useRef(onValueCommit)
  commit.current = onValueCommit
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onCommit = () => commit.current?.([Number(el.value)])
    el.addEventListener("change", onCommit)
    return () => el.removeEventListener("change", onCommit)
  }, [])

  return (
    <input
      ref={ref}
      type="range"
      data-slot="slider"
      min={min}
      max={max}
      step={step}
      value={current}
      disabled={disabled}
      onInput={(e) => {
        const v = Number(e.currentTarget.value)
        setCurrent(v)
        onValueChange?.([v])
      }}
      className={cn("h-5 w-full cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50", className)}
    />
  )
}

export { Slider }
