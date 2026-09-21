import { useEffect, useRef, useState, useId, useMemo } from "react"
import {
  Plus,
  Minus,
  MousePointer2,
  SlidersHorizontal,
  ChartNoAxesCombined,
  ChartColumn,
  Scan,
  Columns2,
  TableProperties,
  RotateCw,
} from "lucide-react"
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import {
  anchoredZoom,
  displayNumber,
  rangeValue,
  pixelPosition,
  imagePosition,
  stepPixel,
} from "@/lib/viewer-navigation"
import { cn } from "@/lib/utils"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Profile } from "@/components/viewer-profile"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Frame } from "@/lib/workbench"
import { Blank } from "@/components/workbench-controls"

import {
  RevealFile,
  ViewerToolButton,
  ViewerPopover,
} from "@/components/viewer-controls"

export type ViewerViewport = { scale: number; x: number; y: number }
export type ViewerMarker = { x: number; y: number; label: string }

type ImageInfo = {
  width: number
  height: number
  mean: number
  median: number
  std: number
  min: number
  max: number
  low: number
  high: number
  header: string
}
type Pixel = {
  x: number
  y: number
  value: number
  row: (number | null)[]
  column: (number | null)[]
}
export function ImageViewer({
  frame,
  onPick,
  onChoose,
  sharedRange,
  embedded = false,
  onCompare,
  onStatistics,
  onReload,
  viewport,
  onViewportChange,
  markers = [],
  selectedMarker,
  selectionMode = false,
  navigationTools = true,
  imageOverlay,
}: {
  frame?: Frame
  onPick?: (x: number, y: number) => void
  onChoose?: () => void
  sharedRange?: [number, number]
  embedded?: boolean
  onCompare?: () => void
  onStatistics?: () => void
  onReload?: () => void
  viewport?: ViewerViewport
  onViewportChange?: (viewport: ViewerViewport) => void
  markers?: ViewerMarker[]
  selectedMarker?: string
  selectionMode?: boolean
  navigationTools?: boolean
  imageOverlay?: React.ReactNode
}) {
  const uid = useId()
  const [rangeError, setRangeError] = useState("")
  const [coordinatesOpen, setCoordinatesOpen] = useState(
    !!onPick && !selectionMode
  )
  const [retry, setRetry] = useState(0)
  const [loading, setLoading] = useState(false)
  const [coordinates, setCoordinates] = useState<[string, string]>(["", ""]),
    [coordinateError, setCoordinateError] = useState("")
  const [info, setInfo] = useState<ImageInfo | null>(null),
    [error, setError] = useState(""),
    [stretch, setStretch] = useState("asinh"),
    [range, setRange] = useState<[string, string]>(["", ""]),
    [applied, setApplied] = useState<[number, number] | null>(null),
    [pixel, setPixel] = useState<Pixel | null>(null)
  const [localScale, setLocalScale] = useState(1),
    [localPan, setLocalPan] = useState({ x: 0, y: 0 }),
    [image, setImage] = useState<HTMLImageElement | null>(null),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [cross, setCross] = useState<{ x: number; y: number } | null>(null)
  // Share offsets relative to the viewport so differently sized panels stay in sync.
  const unit = Math.max(1, Math.min(size.width, size.height))
  const scale = viewport?.scale ?? localScale
  const pan = useMemo(
    () =>
      viewport ? { x: viewport.x * unit, y: viewport.y * unit } : localPan,
    [viewport, unit, localPan]
  )
  function changeView(nextScale: number, nextPan: { x: number; y: number }) {
    if (onViewportChange)
      onViewportChange({
        scale: nextScale,
        x: nextPan.x / unit,
        y: nextPan.y / unit,
      })
    else {
      setLocalScale(nextScale)
      setLocalPan(nextPan)
    }
  }
  function setPan(
    next:
      | { x: number; y: number }
      | ((old: { x: number; y: number }) => { x: number; y: number })
  ) {
    changeView(scale, typeof next === "function" ? next(pan) : next)
  }
  const cursorGuides = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null),
    box = useRef<HTMLDivElement>(null),
    placement = useRef({ x: 0, y: 0, w: 0, h: 0 }),
    drag = useRef<{
      x: number
      y: number
      startX: number
      startY: number
    } | null>(null),
    pixelSequence = useRef(0)
  useEffect(() => {
    let cancelled = false
    ++pixelSequence.current
    if (cursorGuides.current) cursorGuides.current.hidden = true
    setCoordinates(["", ""])
    setCoordinateError("")
    setLoading(!!frame)
    setInfo(null)
    setImage(null)
    setPixel(null)
    setCross(null)
    setLocalScale(1)
    setLocalPan({ x: 0, y: 0 })
    setApplied(null)
    setRangeError("")
    setError("")
    if (frame)
      api<ImageInfo>("info?id=" + frame.id)
        .then((r) => {
          if (!cancelled) {
            setInfo(r)
            setRange([displayNumber(r.low), displayNumber(r.high)])
          }
        })
        .catch((e) => {
          if (!cancelled) {
            setError(e.message)
            setLoading(false)
          }
        })
    return () => {
      cancelled = true
      ++pixelSequence.current
    }
  }, [frame?.id, retry])
  useEffect(() => {
    if (!frame || !info) return
    let cancelled = false
    setLoading(true)
    const im = new Image(),
      r = sharedRange || applied || [info.low, info.high]
    im.onload = () => {
      if (!cancelled) {
        setLoading(false)
        setImage(im)
        setError("")
      }
    }
    im.onerror = () => {
      if (!cancelled) {
        setError("영상을 불러오지 못했습니다.")
        setLoading(false)
      }
    }
    im.src =
      "/api/image?" +
      new URLSearchParams({
        id: frame.id,
        stretch,
        low: String(r[0]),
        high: String(r[1] > r[0] ? r[1] : r[0] + 1),
      })
    return () => {
      cancelled = true
    }
  }, [frame?.id, info, stretch, applied, sharedRange])
  useEffect(() => {
    if (!box.current) return
    const observer = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setSize({ width: r.width, height: r.height })
    })
    observer.observe(box.current)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const target = box.current
    if (!target) return
    const wheel = (e: WheelEvent) => {
      if (
        e.target instanceof Element &&
        e.target.closest("button, input, form, [role=group]")
      )
        return
      e.preventDefault()
      const rect = target.getBoundingClientRect()
      zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      })
    }
    target.addEventListener("wheel", wheel, { passive: false })
    return () => target.removeEventListener("wheel", wheel)
  }, [scale, pan, size])
  useEffect(() => {
    const c = canvas.current
    if (!c) return
    const ctx = c.getContext("2d")
    if (!ctx) return
    const dpr = devicePixelRatio || 1
    c.width = size.width * dpr
    c.height = size.height * dpr
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)
    if (!image || !info) return
    const fit = Math.min(size.width / info.width, size.height / info.height)
    const w = info.width * fit * scale,
      h = info.height * fit * scale,
      x = (size.width - w) / 2 + pan.x,
      y = (size.height - h) / 2 + pan.y
    placement.current = { x, y, w, h }
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(image, x, y, w, h)
    if (cross) {
      const cx = x + ((cross.x - 0.5) / info.width) * w,
        cy = y + ((info.height - cross.y + 0.5) / info.height) * h
      ctx.strokeStyle = "white"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(cx - 10, cy)
      ctx.lineTo(cx + 10, cy)
      ctx.moveTo(cx, cy - 10)
      ctx.lineTo(cx, cy + 10)
      ctx.stroke()
    }
    for (const marker of markers) {
      const mx = x + ((marker.x - 0.5) / info.width) * w
      const my = y + ((info.height - marker.y + 0.5) / info.height) * h
      ctx.save()
      ctx.strokeStyle = "white"
      ctx.fillStyle = "white"
      ctx.lineWidth = marker.label === selectedMarker ? 3 : 1.5
      ctx.shadowColor = "black"
      ctx.shadowBlur = 3
      ctx.beginPath()
      ctx.arc(mx, my, marker.label === selectedMarker ? 11 : 8, 0, Math.PI * 2)
      ctx.stroke()
      ctx.font = "600 12px sans-serif"
      ctx.strokeStyle = "black"
      ctx.lineWidth = 3
      ctx.strokeText(marker.label, mx + 12, my - 10)
      ctx.fillText(marker.label, mx + 12, my - 10)
      ctx.restore()
    }
  }, [
    image,
    info,
    size,
    scale,
    pan,
    cross,
    markers,
    selectedMarker,
    selectionMode,
  ])
  function zoom(
    factor: number,
    anchor = { x: size.width / 2, y: size.height / 2 }
  ) {
    const next = anchoredZoom(scale, pan, anchor, size, factor)
    changeView(next.scale, next.pan)
  }
  const actualScale = info
    ? scale * Math.min(size.width / info.width, size.height / info.height)
    : 0
  function reset() {
    changeView(1, { x: 0, y: 0 })
  }
  function inspect(x: number, y: number, commit = false) {
    if (!info || !frame) return
    setCross({ x, y })
    setCoordinates([String(x), String(y)])
    setCoordinateError("")
    setPixel(null)
    if (onPick) {
      if (commit) onPick(x, y)
      return
    }
    const seq = ++pixelSequence.current
    api<Pixel>(`pixel?id=${frame.id}&x=${x}&y=${y}`)
      .then((p) => {
        if (seq === pixelSequence.current) setPixel(p)
      })
      .catch((e) => {
        if (seq === pixelSequence.current) setError(e.message)
      })
  }
  function pick(clientX: number, clientY: number) {
    if (!info || !frame || !canvas.current) return
    const r = canvas.current.getBoundingClientRect(),
      p = placement.current
    const point = imagePosition(
      { x: clientX - r.left, y: clientY - r.top },
      { x: p.x, y: p.y, width: p.w, height: p.h },
      info,
      selectionMode
    )
    if (point) inspect(point.x, point.y, true)
  }
  return (
    <section
      aria-label={frame?.label || "영상"}
      className="image-viewer @container/viewer"
      data-embedded={embedded}
    >
      {!embedded && (
        <header className="flex min-w-0 items-center justify-between gap-2">
          <h2 className="min-w-0 truncate" title={frame?.label}>
            {onChoose ? (
              <Button
                variant="ghost"
                className="viewer-filename"
                onClick={onChoose}
                title="영상 변경"
              >
                <span>{frame?.label || "영상 선택"}</span>
              </Button>
            ) : (
              frame?.label || "영상"
            )}
          </h2>
          <ButtonGroup aria-label="파일 동작">
            {onReload && (
              <ViewerToolButton label="영상 다시 불러오기" onClick={onReload}>
                <RotateCw />
              </ViewerToolButton>
            )}
            {info && (
              <ViewerPopover label="FITS 헤더" icon={TableProperties}>
                <pre className="max-h-80 overflow-auto text-xs">
                  {info.header}
                </pre>
              </ViewerPopover>
            )}
            {onCompare && (
              <ViewerToolButton label="영상 비교" onClick={onCompare}>
                <Columns2 />
              </ViewerToolButton>
            )}
            {frame && <RevealFile id={frame.id} />}
          </ButtonGroup>
        </header>
      )}
      <div ref={box} className="viewer-image bg-muted">
        {!frame ? (
          <Blank>영상 선택</Blank>
        ) : (
          <canvas
            ref={canvas}
            tabIndex={0}
            aria-label={onPick ? "별 위치 선택" : "영상 픽셀 조사"}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter"
            title="방향키로 픽셀 이동. Shift와 함께 누르면 10픽셀 이동. Enter로 선택."
            className="size-full cursor-crosshair touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            onKeyDown={(e) => {
              if (!info) return
              if (
                ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                  e.key
                )
              ) {
                e.preventDefault()
                const p = stepPixel(cross, e.key, info, e.shiftKey ? 10 : 1)
                inspect(p.x, p.y)
                const fit = Math.min(
                    size.width / info.width,
                    size.height / info.height
                  ),
                  w = info.width * fit * scale,
                  h = info.height * fit * scale
                const px =
                    (size.width - w) / 2 +
                    pan.x +
                    ((p.x - 0.5) / info.width) * w,
                  py =
                    (size.height - h) / 2 +
                    pan.y +
                    ((info.height - p.y + 0.5) / info.height) * h
                setPan((old) => ({
                  x:
                    old.x +
                    (px < 16
                      ? 16 - px
                      : px > size.width - 16
                        ? size.width - 16 - px
                        : 0),
                  y:
                    old.y +
                    (py < 16
                      ? 16 - py
                      : py > size.height - 16
                        ? size.height - 16 - py
                        : 0),
                }))
              } else if (e.key === "Enter" && cross && onPick) {
                e.preventDefault()
                onPick(cross.x, cross.y)
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.focus()
              drag.current = {
                x: e.clientX,
                y: e.clientY,
                startX: pan.x,
                startY: pan.y,
              }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              const guides = cursorGuides.current
              if (guides && image && e.pointerType !== "touch") {
                const rect = e.currentTarget.getBoundingClientRect()
                const x = e.clientX - rect.left,
                  y = e.clientY - rect.top
                guides.hidden =
                  x < 0 || y < 0 || x > rect.width || y > rect.height
                guides.style.setProperty("--cursor-x", `${x}px`)
                guides.style.setProperty("--cursor-y", `${y}px`)
              }
              if (drag.current)
                setPan({
                  x: drag.current.startX + e.clientX - drag.current.x,
                  y: drag.current.startY + e.clientY - drag.current.y,
                })
            }}
            onPointerUp={(e) => {
              if (
                drag.current &&
                Math.hypot(
                  e.clientX - drag.current.x,
                  e.clientY - drag.current.y
                ) < 4
              )
                pick(e.clientX, e.clientY)
              drag.current = null
              e.currentTarget.releasePointerCapture(e.pointerId)
            }}
            onPointerLeave={() => {
              if (cursorGuides.current) cursorGuides.current.hidden = true
            }}
            onPointerCancel={() => {
              drag.current = null
              if (cursorGuides.current) cursorGuides.current.hidden = true
            }}
          />
        )}

        {selectionMode && (
          <div
            ref={cursorGuides}
            className="viewer-cursor-guides"
            hidden
            aria-hidden="true"
          >
            <span />
            <span />
          </div>
        )}
        {imageOverlay}
        <ButtonGroup className="viewer-panel-switch" aria-label="영상 분석">
          <ViewerPopover
            label="표시 설정"
            icon={SlidersHorizontal}
            disabled={!info}
          >
            <form
              className="flex flex-col gap-5"
              onSubmit={(event) => {
                event.preventDefault()
                if (!info || sharedRange) return
                const low = rangeValue(range[0], info.low),
                  high = rangeValue(range[1], info.high)
                if (
                  !Number.isFinite(low) ||
                  !Number.isFinite(high) ||
                  high <= low
                ) {
                  setRangeError("최댓값은 최솟값보다 커야 합니다.")
                  return
                }
                setRangeError("")
                setApplied([low, high])
              }}
            >
              <Field>
                <FieldLabel id={`${uid}-stretch`}>명암 변환</FieldLabel>
                <ToggleGroup
                  variant="outline"
                  spacing={0}
                  aria-labelledby={`${uid}-stretch`}
                  value={[stretch]}
                  onValueChange={(values) => {
                    if (values.length) setStretch(values[0])
                  }}
                >
                  <ToggleGroupItem value="asinh">Asinh</ToggleGroupItem>
                  <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
                </ToggleGroup>
              </Field>
              {info && (
                <FieldSet className="gap-3">
                  <FieldLegend variant="label">
                    밝기 범위 <span className="text-muted-foreground">ADU</span>
                  </FieldLegend>
                  <FieldGroup className="grid grid-cols-2 gap-3">
                    {(["최솟값", "최댓값"] as const).map((label, i) => (
                      <Field key={label} data-invalid={!!rangeError}>
                        <FieldLabel htmlFor={`${uid}-range-${i}`}>
                          {label}
                        </FieldLabel>
                        <Input
                          id={`${uid}-range-${i}`}
                          inputMode="decimal"
                          aria-invalid={!!rangeError}
                          aria-describedby={
                            rangeError ? `${uid}-range-error` : undefined
                          }
                          value={
                            sharedRange
                              ? displayNumber(sharedRange[i])
                              : range[i]
                          }
                          disabled={!!sharedRange}
                          onChange={(event) => {
                            setRange((value) =>
                              i === 0
                                ? [event.target.value, value[1]]
                                : [value[0], event.target.value]
                            )
                            setRangeError("")
                          }}
                        />
                      </Field>
                    ))}
                  </FieldGroup>
                  {sharedRange && (
                    <FieldDescription>
                      두 영상에 같은 범위를 적용 중입니다.
                    </FieldDescription>
                  )}
                  {rangeError && (
                    <p
                      id={`${uid}-range-error`}
                      role="alert"
                      className="text-sm text-destructive"
                    >
                      {rangeError}
                    </p>
                  )}
                  <div className="flex justify-between gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!!sharedRange}
                      onClick={() => {
                        setApplied(null)
                        setRange([
                          displayNumber(info.low),
                          displayNumber(info.high),
                        ])
                        setRangeError("")
                      }}
                    >
                      자동 범위
                    </Button>
                    <Button
                      type="submit"
                      variant="outline"
                      size="sm"
                      disabled={!!sharedRange}
                    >
                      적용
                    </Button>
                  </div>
                </FieldSet>
              )}
            </form>
          </ViewerPopover>
          {!selectionMode && (
            <ViewerPopover
              label="영상 통계"
              icon={ChartColumn}
              disabled={!info}
            >
              {info && (
                <>
                  <div className="flex justify-between gap-4 text-sm text-muted-foreground">
                    <span>영상 크기</span>
                    <span className="tabular-nums">
                      {info.width} × {info.height} px
                    </span>
                  </div>
                  <dl className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-3 text-sm">
                    {(
                      [
                        ["평균", info.mean],
                        ["중앙값", info.median],
                        ["표준편차", info.std],
                        ["최솟값", info.min],
                        ["최댓값", info.max],
                      ] as const
                    ).map(([label, value]) => (
                      <div key={label} className="contents">
                        <dt>{label}</dt>
                        <dd className="col-span-2 grid grid-cols-subgrid">
                          <span className="text-right tabular-nums">
                            {displayNumber(value)}
                          </span>
                          <span className="text-muted-foreground">ADU</span>
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {onStatistics && (
                    <Button variant="outline" size="sm" onClick={onStatistics}>
                      imstatistics로 분석
                    </Button>
                  )}
                </>
              )}
            </ViewerPopover>
          )}
          {!onPick && (
            <ViewerPopover
              label="픽셀 프로파일"
              icon={ChartNoAxesCombined}
              disabled={!info}
              className="w-96"
            >
              {pixel ? (
                <div className="flex min-w-0 flex-col gap-5">
                  <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">X</dt>
                      <dd>{pixel.x}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="text-muted-foreground">Y</dt>
                      <dd>{pixel.y}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="sr-only">픽셀 값</dt>
                      <dd>{displayNumber(pixel.value)} ADU</dd>
                    </div>
                  </dl>
                  <Profile
                    values={pixel.row}
                    label="가로 단면"
                    selected={pixel.x}
                    axis="X"
                  />
                  <Profile
                    values={pixel.column}
                    label="세로 단면"
                    selected={pixel.y}
                    axis="Y"
                  />
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  영상을 클릭해 픽셀을 선택하면 가로와 세로 밝기 분포를 볼 수
                  있습니다.
                </p>
              )}
            </ViewerPopover>
          )}
        </ButtonGroup>
        {navigationTools && (
          <div className="viewer-zoom">
            <ButtonGroup aria-label="확대 및 축소">
              <ViewerToolButton
                variant="outline"
                label="축소"
                disabled={!image}
                onClick={() => zoom(1 / 1.25)}
              >
                <Minus />
              </ViewerToolButton>
              <ButtonGroupText
                render={<output aria-label="현재 배율" />}
                className="min-w-16 justify-center tabular-nums"
              >
                {info ? `${Math.round(actualScale * 1000) / 10}%` : "—"}
              </ButtonGroupText>
              <ViewerToolButton
                variant="outline"
                label="확대"
                disabled={!image}
                onClick={() => zoom(1.25)}
              >
                <Plus />
              </ViewerToolButton>
            </ButtonGroup>
            <ButtonGroup aria-label="영상 맞춤">
              <ViewerToolButton
                variant="outline"
                label="화면에 맞춤"
                disabled={!image}
                onClick={reset}
              >
                <Scan />
              </ViewerToolButton>
            </ButtonGroup>
          </div>
        )}
        <div className="viewer-coordinate-overlay">
          <Popover open={coordinatesOpen} onOpenChange={setCoordinatesOpen}>
            <ButtonGroup className="viewer-pixel" aria-label="픽셀 좌표">
              <PopoverTrigger
                render={<Button variant="outline" size="icon-sm" />}
                aria-label="좌표 입력"
                title="좌표 입력"
                disabled={!info}
              >
                <MousePointer2 />
              </PopoverTrigger>
              {cross && !selectionMode && (
                <ButtonGroupText
                  render={<output aria-live="polite" />}
                  className="flex-wrap tabular-nums"
                >
                  <span>X {cross.x}</span>
                  <span>Y {cross.y}</span>
                  {pixel && <span>{displayNumber(pixel.value)} ADU</span>}
                </ButtonGroupText>
              )}
            </ButtonGroup>
            <PopoverContent
              side="top"
              align="start"
              className="max-w-[calc(100vw-2rem)]"
            >
              <PopoverHeader>
                <PopoverTitle>픽셀 좌표</PopoverTitle>
              </PopoverHeader>
              <form
                className="flex flex-col gap-4"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!info) return
                  const point = pixelPosition(
                    ...coordinates,
                    info,
                    selectionMode
                  )
                  if (!point) {
                    setCoordinateError(
                      `X는 1–${info.width}, Y는 1–${info.height} 범위로 입력해 주세요.`
                    )
                    return
                  }
                  inspect(point.x, point.y, true)
                  setCoordinatesOpen(false)
                }}
              >
                <FieldGroup className="grid grid-cols-2 gap-3">
                  {(["X", "Y"] as const).map((axis, i) => (
                    <Field key={axis} data-invalid={!!coordinateError}>
                      <FieldLabel htmlFor={`${uid}-${axis}`}>{axis}</FieldLabel>
                      <Input
                        id={`${uid}-${axis}`}
                        aria-label={`픽셀 ${axis}`}
                        aria-invalid={!!coordinateError}
                        aria-describedby={
                          coordinateError
                            ? `${uid}-coordinate-error`
                            : undefined
                        }
                        inputMode={selectionMode ? "decimal" : "numeric"}
                        value={coordinates[i]}
                        disabled={!info}
                        onChange={(event) => {
                          setCoordinates((value) =>
                            i === 0
                              ? [event.target.value, value[1]]
                              : [value[0], event.target.value]
                          )
                          setCoordinateError("")
                        }}
                      />
                    </Field>
                  ))}
                </FieldGroup>
                {coordinateError && (
                  <p
                    id={`${uid}-coordinate-error`}
                    role="alert"
                    className="text-sm text-destructive"
                  >
                    {coordinateError}
                  </p>
                )}
                <Button
                  className="self-end"
                  variant="outline"
                  size="sm"
                  type="submit"
                  disabled={!info}
                >
                  {onPick ? "좌표 선택" : "픽셀 조사"}
                </Button>
              </form>
            </PopoverContent>
          </Popover>
        </div>
        {loading && (
          <div className="viewer-load-state" role="status">
            영상 불러오는 중…
          </div>
        )}
        {error && (
          <div className="viewer-load-state" role="alert">
            <span>{error}</span>
            <Button
              variant="outline"
              onClick={() => {
                setError("")
                setRetry((v) => v + 1)
              }}
            >
              다시 시도
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}

export function ViewerWorkspace({
  comparisonInHeader = false,
  ids,
  rows,
  onChoose,
  onStatistics,
}: {
  comparisonInHeader?: boolean
  ids: string[]
  rows: Frame[]
  onChoose: (second?: boolean) => void
  onStatistics?: () => void
}) {
  const [view, setView] = useState("split"),
    [same, setSame] = useState(false),
    [range, setRange] = useState<[number, number] | undefined>()
  useEffect(() => {
    let cancelled = false
    if (same && ids.length > 1)
      Promise.all(ids.map((id) => api<ImageInfo>("info?id=" + id)))
        .then((infos) => {
          if (!cancelled)
            setRange([
              Math.min(...infos.map((i) => i.low)),
              Math.max(...infos.map((i) => i.high)),
            ])
        })
        .catch(() => {
          if (!cancelled) setRange(undefined)
        })
    else setRange(undefined)
    return () => {
      cancelled = true
    }
  }, [same, ids])
  return (
    <div className="viewer-workspace">
      <div
        className="viewer-comparison"
        hidden={comparisonInHeader && ids.length < 2}
      >
        {!comparisonInHeader && (
          <ViewerToolButton label="영상 비교" onClick={() => onChoose(true)}>
            <Columns2 />
          </ViewerToolButton>
        )}
        {ids.length > 1 && (
          <>
            <ToggleGroup
              variant="outline"
              value={[view]}
              onValueChange={(v) => {
                if (v.length) setView(v[0])
              }}
            >
              <ToggleGroupItem value="a">A</ToggleGroupItem>
              <ToggleGroupItem value="b">B</ToggleGroupItem>
              <ToggleGroupItem value="split">나란히</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              value={[same ? "same" : "each"]}
              onValueChange={(v) => {
                if (v.length) setSame(v[0] === "same")
              }}
            >
              <ToggleGroupItem value="each">개별 범위</ToggleGroupItem>
              <ToggleGroupItem value="same">같은 범위</ToggleGroupItem>
            </ToggleGroup>
          </>
        )}
      </div>
      <div
        className={cn(
          "viewer-grid",
          ids.length > 1 && view === "split" && "viewer-grid-split"
        )}
      >
        {(ids.length > 1
          ? view === "a"
            ? [ids[0]]
            : view === "b"
              ? [ids[1]]
              : ids
          : [ids[0]]
        ).map((id) => (
          <ImageViewer
            key={id || "empty"}
            frame={rows.find((r) => r.id === id)}
            sharedRange={range}
            embedded={ids.length === 1}
            onStatistics={onStatistics}

            onChoose={() => onChoose(id === ids[1])}
          />
        ))}
      </div>
    </div>
  )
}
