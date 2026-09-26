import { useEffect, useId, useRef, useState } from "react"

function tickLabel(value: number) {
  if (value === 0) return "0"
  const magnitude = Math.abs(value)
  return magnitude >= 100000 || magnitude < 0.01
    ? value.toExponential(2)
    : Number(value.toPrecision(5)).toLocaleString("en-US")
}

export function Profile({
  values,
  label,
  selected,
  axis,
}: {
  values: (number | null)[]
  label: string
  selected: number
  axis: "X" | "Y"
}) {
  const titleId = useId()
  const figure = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(320)
  useEffect(() => {
    if (!figure.current) return
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(240, entry.contentRect.width))
    )
    observer.observe(figure.current)
    return () => observer.disconnect()
  }, [])
  let minimum = Infinity
  let maximum = -Infinity
  for (const value of values) {
    if (value !== null && Number.isFinite(value)) {
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
  }
  const hasData = Number.isFinite(minimum)
  const left = 76
  const right = width - 20
  const top = 20
  const bottom = 128
  const x = (index: number) =>
    values.length <= 1
      ? (left + right) / 2
      : left + (index / (values.length - 1)) * (right - left)
  // Normalize first so even very large finite FITS values cannot overflow.
  const scale = hasData ? Math.max(Math.abs(minimum), Math.abs(maximum), 1) : 1
  const low = minimum / scale
  const high = maximum / scale
  const y = (value: number) =>
    minimum === maximum
      ? (top + bottom) / 2
      : bottom - ((value / scale - low) / (high - low)) * (bottom - top)
  let path = ""
  let connected = false
  values.forEach((value, index) => {
    if (value === null || !Number.isFinite(value)) {
      connected = false
      return
    }
    const point = `${x(index).toFixed(2)},${y(value).toFixed(2)}`
    // A zero-length segment with a round cap also exposes isolated valid pixels.
    path += connected ? ` L${point}` : ` M${point} L${point}`
    connected = true
  })
  const yTicks = !hasData
    ? []
    : minimum === maximum
      ? [minimum]
      : [minimum, minimum / 2 + maximum / 2, maximum]
  const xTicks =
    values.length === 0
      ? []
      : [...new Set([1, Math.round((values.length + 1) / 2), values.length])]
  const hasSelection =
    Number.isInteger(selected) && selected >= 1 && selected <= values.length

  return (
    <figure ref={figure} className="min-w-0 flex-1">
      <figcaption className="mb-1 flex items-baseline justify-between gap-3 text-sm">
        <span>{label}</span>
      </figcaption>
      <svg
        role="img"
        aria-labelledby={titleId}
        viewBox={`0 0 ${width} 164`}
        className="h-40 w-full overflow-visible text-xs tabular-nums"
      >
        <title id={titleId}>
          {label}: {axis} 픽셀 좌표에 따른 ADU 값
        </title>
        <g fill="var(--muted-foreground)">
          <text x={left - 12} y={12} textAnchor="end">
            ADU
          </text>
          {yTicks.map((value, index) => (
            <g key={index}>
              <line
                x1={left}
                x2={right}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--border)"
                vectorEffect="non-scaling-stroke"
              />
              <text x={left - 10} y={y(value)} dy="0.35em" textAnchor="end">
                {tickLabel(value)}
              </text>
            </g>
          ))}
          <path
            d={`M${left},${top} V${bottom} H${right}`}
            stroke="var(--muted-foreground)"
            fill="none"
            vectorEffect="non-scaling-stroke"
          />
          {xTicks.map((value) => (
            <g key={value}>
              <line
                x1={x(value - 1)}
                x2={x(value - 1)}
                y1={bottom}
                y2={bottom + 4}
                stroke="var(--muted-foreground)"
              />
              <text x={x(value - 1)} y={bottom + 17} textAnchor="middle">
                {value}
              </text>
            </g>
          ))}
          <text x={(left + right) / 2} y={162} textAnchor="middle">
            {axis}
            <tspan dx="8">픽셀</tspan>
          </text>
        </g>
        {hasSelection && (
          <line
            x1={x(selected - 1)}
            x2={x(selected - 1)}
            y1={top}
            y2={bottom}
            stroke="var(--muted-foreground)"
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
        )}
        {hasData ? (
          <path
            d={path}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.25"
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        ) : (
          <text
            x={(left + right) / 2}
            y={(top + bottom) / 2}
            textAnchor="middle"
            fill="var(--muted-foreground)"
          >
            유효한 픽셀 값이 없습니다
          </text>
        )}
      </svg>
    </figure>
  )
}
