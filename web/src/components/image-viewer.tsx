import { useEffect, useRef, useState, useId } from "react"
import {
  ZoomIn,
  ZoomOut,
  Maximize,
  MousePointer2,
  X,
  SlidersHorizontal,
  ChartNoAxesCombined,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  anchoredZoom,
  displayNumber,
  rangeValue,
  pixelPosition,
  stepPixel,
} from "@/lib/viewer-navigation"
import { cn } from "@/lib/utils"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Profile } from "@/components/viewer-profile"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { api, type Frame } from "@/lib/workbench"
import { Choice, Blank, Download } from "@/components/workbench-controls"

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
}: {
  frame?: Frame
  onPick?: (x: number, y: number) => void
  onChoose?: () => void
  sharedRange?: [number, number]
  embedded?: boolean
  onCompare?: () => void
  onStatistics?: () => void
}) {
  const uid = useId()
  const [toolsOpen, setToolsOpen] = useState(false)
  const [tool, setTool] = useState("display")
  const [profileOpen, setProfileOpen] = useState(false)
  const [coordinatesOpen, setCoordinatesOpen] = useState(!!onPick)
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
  const [scale, setScale] = useState(1),
    [native, setNative] = useState(false),
    [pan, setPan] = useState({ x: 0, y: 0 }),
    [image, setImage] = useState<HTMLImageElement | null>(null),
    [size, setSize] = useState({ width: 0, height: 0 }),
    [cross, setCross] = useState<{ x: number; y: number } | null>(null)
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
    setCoordinates(["", ""])
    setCoordinateError("")
    setLoading(!!frame)
    setInfo(null)
    setImage(null)
    setPixel(null)
    setCross(null)
    setScale(1)
    setNative(false)
    setPan({ x: 0, y: 0 })
    setApplied(null)
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
    const fit = native
      ? 1
      : Math.min(size.width / info.width, size.height / info.height)
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
  }, [image, info, size, scale, pan, native, cross])
  function zoom(
    factor: number,
    anchor = { x: size.width / 2, y: size.height / 2 }
  ) {
    const next = anchoredZoom(scale, pan, anchor, size, factor)
    setScale(next.scale)
    setPan(next.pan)
  }
  const actualScale = info
    ? scale *
      (native
        ? 1
        : Math.min(size.width / info.width, size.height / info.height))
    : 0
  function reset() {
    setScale(1)
    setNative(false)
    setPan({ x: 0, y: 0 })
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
    if (!p.w || !p.h) return
    const x = Math.floor(((clientX - r.left - p.x) / p.w) * info.width) + 1,
      y =
        info.height - Math.floor(((clientY - r.top - p.y) / p.h) * info.height)
    if (x >= 1 && y >= 1 && x <= info.width && y <= info.height)
      inspect(x, y, true)
  }
  return (
    <section
      aria-label={frame?.label || "영상"}
      className="image-viewer @container/viewer"
      data-embedded={embedded}
      data-tools-open={toolsOpen}
      data-profile-open={profileOpen}
    >
      {!embedded && (
        <header className="flex min-w-0 items-center justify-between gap-2">
          <h2 className="min-w-0">
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
        </header>
      )}
      <div ref={box} className="viewer-image bg-muted">
        {!frame ? (
          <Blank>영상 선택</Blank>
        ) : (
          <canvas
            ref={canvas}
            tabIndex={0}
            aria-label={onPick ? "조사할 위치 선택" : "영상 픽셀 조사"}
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
                const fit = native
                    ? 1
                    : Math.min(
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
            onPointerCancel={() => {
              drag.current = null
            }}
          />
        )}

        <div
          className="viewer-overlay viewer-panel-switch"
          role="group"
          aria-label="영상 분석"
        >
          <Button
            variant="ghost"
            aria-pressed={toolsOpen && tool === "display"}
            aria-controls={`${uid}-tools`}
            onClick={() => {
              setToolsOpen(!(toolsOpen && tool === "display"))
              setTool("display")
            }}
          >
            <SlidersHorizontal />
            표시
          </Button>
          <Button
            variant="ghost"
            aria-pressed={toolsOpen && tool === "stats"}
            aria-controls={`${uid}-tools`}
            onClick={() => {
              setToolsOpen(!(toolsOpen && tool === "stats"))
              setTool("stats")
            }}
          >
            통계
          </Button>
          {!onPick && (
            <Button
              variant="ghost"
              aria-pressed={profileOpen}
              aria-controls={`${uid}-profiles`}
              onClick={() => setProfileOpen((v) => !v)}
            >
              <ChartNoAxesCombined />
              프로파일
            </Button>
          )}
        </div>
        <div
          className="viewer-overlay viewer-zoom"
          role="group"
          aria-label="확대 및 축소"
        >
          <Button
            variant="ghost"
            size="icon"
            aria-label="축소"
            title="축소"
            disabled={!image}
            onClick={() => zoom(1 / 1.25)}
          >
            <ZoomOut />
          </Button>
          <output className="viewer-scale" aria-label="현재 배율">
            {info ? `${Math.round(actualScale * 1000) / 10}%` : "—"}
          </output>
          <Button
            variant="ghost"
            size="icon"
            aria-label="확대"
            title="확대"
            disabled={!image}
            onClick={() => zoom(1.25)}
          >
            <ZoomIn />
          </Button>
          <Button
            variant="ghost"
            aria-label="화면에 맞춤"
            aria-pressed={!native && scale === 1}
            disabled={!image}
            onClick={reset}
          >
            <Maximize />
            맞춤
          </Button>
          <Button
            variant="ghost"
            title="원본 크기"
            aria-pressed={native && scale === 1}
            disabled={!image}
            onClick={() => {
              setNative(true)
              setScale(1)
              setPan({ x: 0, y: 0 })
            }}
          >
            1:1
          </Button>
        </div>
        <div className="viewer-coordinate-overlay">
          <form
            className="viewer-coordinates"
            hidden={!coordinatesOpen}
            onSubmit={(e) => {
              e.preventDefault()
              if (!info) return
              const p = pixelPosition(...coordinates, info)
              if (!p) {
                setCoordinateError(`X는 1부터 ${info.width}, Y는 1부터 ${info.height}까지 입력해 주세요.`)
                return
              }
              inspect(p.x, p.y, true)
            }}
          >
            <FieldGroup className="flex-row items-center gap-2">
              {(["X", "Y"] as const).map((axis, i) => (
                <Field
                  key={axis}
                  className="min-w-0"
                  data-invalid={!!coordinateError}
                >
                  <FieldLabel htmlFor={`${uid}-${axis}`}>{axis}</FieldLabel>
                  <Input
                    id={`${uid}-${axis}`}
                    aria-label={`픽셀 ${axis}`}
                    aria-invalid={!!coordinateError}
                    aria-describedby={
                      coordinateError ? `${uid}-coordinate-error` : undefined
                    }
                    className="w-20"
                    inputMode="numeric"
                    value={coordinates[i]}
                    disabled={!info}
                    onChange={(e) => {
                      setCoordinates((v) =>
                        i === 0
                          ? [e.target.value, v[1]]
                          : [v[0], e.target.value]
                      )
                      setCoordinateError("")
                    }}
                  />
                </Field>
              ))}
              <Button variant="outline" type="submit" disabled={!info}>
                {onPick ? "선택" : "조사"}
              </Button>
            </FieldGroup>
          </form>
          {coordinatesOpen && coordinateError && (
            <p
              id={`${uid}-coordinate-error`}
              role="alert"
              className="text-destructive"
            >
              {coordinateError}
            </p>
          )}

          <Button
            className="viewer-overlay viewer-pixel"
            variant="ghost"
            aria-expanded={coordinatesOpen}
            onClick={() => setCoordinatesOpen((v) => !v)}
            title="좌표 입력"
          >
            <MousePointer2 />
            <span aria-live="polite">
              {cross
                ? <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><span>X {cross.x}</span><span>Y {cross.y}</span>{pixel && <span>{displayNumber(pixel.value)} ADU</span>}</span>
                : "좌표 입력"}
            </span>
          </Button>
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
      <aside
        id={`${uid}-tools`}
        aria-label="영상 도구"
        className="viewer-tools"
        hidden={!toolsOpen}
      >
        <header className="viewer-panel-heading">
          <h3>{tool === "display" ? "표시" : "통계"}</h3>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="영상 도구 닫기"
            onClick={() => setToolsOpen(false)}
          >
            <X />
          </Button>
        </header>
        {tool === "display" && (
          <div className="viewer-display">
            <Field>
              <FieldLabel>표시 변환</FieldLabel>
              <Choice
                label="표시 변환"
                value={stretch}
                onChange={setStretch}
                options={[
                  { value: "asinh", label: "Asinh" },
                  { value: "linear", label: "Linear" },
                ]}
              />
            </Field>
            {info && (
              <>
                <div className="viewer-range-heading">
                  <span>표시 범위</span>
                  <span className="text-muted-foreground">
                    {sharedRange ? "공통" : applied ? "수동" : "자동"}
                  </span>
                </div>
                <FieldGroup className="viewer-range">
                  {(["하한", "상한"] as const).map((label, i) => (
                    <Field key={label} className="min-w-0">
                      <FieldLabel htmlFor={`${uid}-range-${i}`}>
                        {label}<span className="ml-auto text-muted-foreground">ADU</span>
                      </FieldLabel>
                      <Input
                        id={`${uid}-range-${i}`}
                        value={
                          sharedRange ? displayNumber(sharedRange[i]) : range[i]
                        }
                        disabled={!!sharedRange}
                        onChange={(e) =>
                          setRange((v) =>
                            i === 0
                              ? [e.target.value, v[1]]
                              : [v[0], e.target.value]
                          )
                        }
                      />
                    </Field>
                  ))}
                  <Button
                    variant="outline"
                    disabled={!!sharedRange}
                    onClick={() => {
                      const a = rangeValue(range[0], info.low),
                        b = rangeValue(range[1], info.high)
                      if (
                        !Number.isFinite(a) ||
                        !Number.isFinite(b) ||
                        b <= a
                      ) {
                        setError("상한은 하한보다 커야 합니다.")
                        return
                      }
                      setError("")
                      setApplied([a, b])
                    }}
                  >
                    적용
                  </Button>
                  <Button
                    variant="outline"
                    disabled={!!sharedRange}
                    onClick={() => {
                      setApplied(null)
                      setRange([
                        displayNumber(info.low),
                        displayNumber(info.high),
                      ])
                    }}
                  >
                    자동
                  </Button>
                </FieldGroup>
              </>
            )}
          </div>
        )}
        {tool === "stats" && info && (
          <div>
            {" "}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>항목</TableHead>
                  <TableHead>값</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[
                  ["크기", `${info.width} × ${info.height}`],
                  ["평균", info.mean],
                  ["중앙값", info.median],
                  ["표준편차", info.std],
                  ["최소", info.min],
                  ["최대", info.max],
                ].map(([label, value]) => (
                  <TableRow key={label}>
                    <TableCell>{label}</TableCell>
                    <TableCell>
                      {typeof value === "number"
                        ? value.toLocaleString(undefined, {
                            maximumFractionDigits: 4,
                          })
                        : value}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            {onStatistics && (
              <Button
                className="mt-3 w-full"
                variant="outline"
                onClick={onStatistics}
              >
                IRAF 통계 실행
              </Button>
            )}
          </div>
        )}
        {!embedded && info && (
          <details>
            <summary className="cursor-pointer">FITS 헤더</summary>
            <pre className="max-h-80 overflow-auto py-3">{info.header}</pre>
          </details>
        )}
        {!embedded && frame && <Download id={frame.id} />}
        {onCompare && (
          <Button variant="outline" onClick={onCompare}>
            비교
          </Button>
        )}
      </aside>
      {profileOpen && (
        <section
          id={`${uid}-profiles`}
          className="viewer-profiles"
          aria-label="픽셀 프로파일"
        >
          <header className="viewer-panel-heading">
            <h3>프로파일</h3>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="프로파일 닫기"
              onClick={() => setProfileOpen(false)}
            >
              <X />
            </Button>
          </header>
          {pixel ? (
            <div className="viewer-profile-grid">
              <Profile
                values={pixel.row}
                label={`행 Y=${pixel.y}`}
                selected={pixel.x}
                axis="X"
              />
              <Profile
                values={pixel.column}
                label={`열 X=${pixel.x}`}
                selected={pixel.y}
                axis="Y"
              />
            </div>
          ) : (
            <p className="text-muted-foreground">영상에서 픽셀을 선택하세요.</p>
          )}
        </section>
      )}
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
          <Button variant="outline" onClick={() => onChoose(true)}>
            비교
          </Button>
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
