import { AlignmentCoordinates } from "./Coordinates"
import { useId, useState, useEffect, useRef } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Trash2, Plus, Minus, Scan, LoaderCircle } from "lucide-react"
import { ViewerToolButton } from "@/features/viewer/controls"
import { cn } from "@/lib/utils"
import { ImageViewer, type ViewerViewport } from "@/features/viewer/ImageViewer"
import {
  parsePairs,
  alignmentRows,
  shiftsFromStars,
  type Pair,
} from "@/lib/alignment"
import { api, type Frame } from "@/lib/workbench"

export function AlignmentInput({
  name,
  value,
  onChange,
  fileInput,
  hasFile,
  reference: suppliedReference,
  frames,
  backend,
  onUseReference,
}: {
  name: "coords" | "shifts"
  value: string
  onChange: (value: string) => void
  fileInput: React.ReactNode
  hasFile: boolean
  reference?: Frame
  frames: Frame[]
  backend: string
  onUseReference: (frame: Frame) => void
  coords: string
}) {
  const reference = frames[0] || suppliedReference
  const [measuring, setMeasuring] = useState(false)
  const [measurementError, setMeasurementError] = useState("")
  const request = useRef(0)
  const pending = useRef(false)
  useEffect(
    () => () => {
      ++request.current
    },
    []
  )
  function closePicker(nextOpen: boolean) {
    if (!nextOpen) {
      ++request.current
      pending.current = false
      setMeasuring(false)
    }
    setOpen(nextOpen)
  }
  async function measure(
    frame: Frame | undefined,
    x: number,
    y: number,
    apply: (point: Pair) => void
  ) {
    if (!frame || pending.current) return
    const sequence = ++request.current
    pending.current = true
    setMeasuring(true)
    setMeasurementError("")
    try {
      const point = await api<{ x: number; y: number }>("alignment-star", {
        id: frame.id,
        x,
        y,
        backend,
      })
      if (sequence === request.current) apply([point.x, point.y])
    } catch (error) {
      if (sequence === request.current)
        setMeasurementError((error as Error).message)
    } finally {
      if (sequence === request.current) {
        pending.current = false
        setMeasuring(false)
      }
    }
  }
  const id = useId(),
    isCoords = name === "coords"
  const [mode, setMode] = useState(hasFile ? "file" : "direct")
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<number | null>(null)
  const [anchor, setAnchor] = useState<Pair>()
  const [points, setPoints] = useState<Record<number, Pair>>({})
  const [viewport, setViewport] = useState<ViewerViewport>({
    scale: 1,
    x: 0,
    y: 0,
  })
  const rows = alignmentRows(value)
  function pickStar(index: number, point: Pair) {
    if (!reference) return
    const nextAnchor = index === -1 ? point : anchor
    const nextPoints = index === -1 ? points : { ...points, [index]: point }
    setAnchor(nextAnchor)
    setPoints(nextPoints)
    if (!nextAnchor) return
    onChange(
      shiftsFromStars(
        nextAnchor,
        nextPoints,
        reference.id,
        frames.map((f) => f.id)
      )
    )
  }
  const pairs = parsePairs(value)
  const invalid =
    !!value.trim() &&
    (!pairs ||
      (isCoords
        ? pairs.some((p) => p.some((v) => v < 1))
        : frames.length > 0 && pairs.length !== frames.length))
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{name}</FieldLabel>
      <Tabs value={mode} onValueChange={(v) => setMode(String(v))}>
        <TabsList className="w-full">
          <TabsTrigger value="direct">직접 입력</TabsTrigger>
          <TabsTrigger value="file">기존 입력</TabsTrigger>
        </TabsList>
        <TabsContent
          value="direct"
          className="flex min-w-0 flex-col gap-3 pt-2"
        >
          <Textarea
            id={id}
            aria-invalid={invalid}
            value={value}
            rows={4}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          {invalid && (
            <p role="alert" className="text-sm text-destructive">
              {isCoords
                ? "각 행에 1 이상의 X Y 두 수치를 입력해 주세요."
                : "입력 영상마다 ΔX ΔY 두 수치를 입력해 주세요. 미선택 행의 ?를 채워 주세요."}
            </p>
          )}
          <Button
            variant="outline"
            disabled={isCoords ? !reference : !reference || !frames.length}
            onClick={() => {
              if (reference) onUseReference(reference)
              setMeasurementError("")
              setSelected(null)
              setAnchor(undefined)
              setPoints({})
              setViewport({ scale: 1, x: 0, y: 0 })
              setOpen(true)
            }}
          >
            {isCoords ? "영상에서 별 선택" : "같은 별로 이동량 계산"}
          </Button>
          {!reference && (
            <FieldDescription>기준 영상을 먼저 선택해 주세요.</FieldDescription>
          )}
          {!isCoords && frames.length > 0 && (
            <ol
              className="flex flex-col gap-1 text-sm text-muted-foreground"
              aria-label="이동량 행 순서"
            >
              {frames.map((f, i) => (
                <li key={`${i}:${f.id}`} className="truncate" title={f.label}>
                  {i + 1}. {f.label}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        <TabsContent value="file" className="pt-2">
          {value.trim() ? (
            <Button variant="outline" onClick={() => onChange("")}>
              직접 입력을 비우고 파일 선택
            </Button>
          ) : (
            fileInput
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={open} onOpenChange={closePicker}>
        <DialogContent
          className={cn(
            "alignment-picker",
            !isCoords && "alignment-picker-shifts"
          )}
          aria-describedby={undefined}
        >
          <DialogHeader className="alignment-picker-header">
            <DialogTitle>{name}</DialogTitle>
            {measuring && (
              <span role="status" aria-label="별 중심 측정 중">
                <LoaderCircle className="size-4 animate-spin" />
              </span>
            )}
            {isCoords && (
              <span
                className="min-w-0 flex-1 truncate text-sm"
                title={reference?.label}
              >
                {reference?.label}
              </span>
            )}
            <div
              className="alignment-navigation"
              role="group"
              aria-label="전체 영상 확대 및 이동"
            >
              <ViewerToolButton
                label="전체 영상 축소"
                onClick={() =>
                  setViewport((v) => {
                    const scale = Math.max(0.1, v.scale / 1.25)
                    return {
                      ...v,
                      scale,
                      x: (v.x * scale) / v.scale,
                      y: (v.y * scale) / v.scale,
                    }
                  })
                }
              >
                <Minus />
              </ViewerToolButton>
              <ViewerToolButton
                label="전체 영상 확대"
                onClick={() =>
                  setViewport((v) => {
                    const scale = Math.min(32, v.scale * 1.25)
                    return {
                      ...v,
                      scale,
                      x: (v.x * scale) / v.scale,
                      y: (v.y * scale) / v.scale,
                    }
                  })
                }
              >
                <Plus />
              </ViewerToolButton>
              <ViewerToolButton
                label="전체 영상 맞춤"
                onClick={() => setViewport({ scale: 1, x: 0, y: 0 })}
              >
                <Scan />
              </ViewerToolButton>
            </div>
          </DialogHeader>
          {open &&
            (isCoords ? (
              <AlignmentCoordinates
                reference={reference}
                viewport={viewport}
                setViewport={setViewport}
                rows={rows}
                selected={selected}
                measure={measure}
                onChange={onChange}
                setSelected={setSelected}
                measuring={measuring}
              />
            ) : (
              <div
                className="alignment-frame-grid"
                data-count={
                  frames.filter((f) => f.id !== reference?.id).length + 1
                }
              >
                {[
                  { frame: reference, index: -1 },
                  ...frames.flatMap((frame, index) =>
                    frame.id === reference?.id ? [] : [{ frame, index }]
                  ),
                ].map(({ frame, index }) => {
                  const point = index === -1 ? anchor : points[index]
                  const shift =
                    index >= 0 ? value.trim().split("\n")[index] : undefined
                  return (
                    <section
                      key={index}
                      className="alignment-frame"
                      aria-label={
                        index === -1 ? "기준 영상" : `입력 영상 ${index + 1}`
                      }
                    >
                      <header className="flex min-w-0 items-center gap-2 px-2 text-xs">
                        <span className="shrink-0 text-muted-foreground">
                          {index === -1 ? "ref" : index + 1}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={frame?.label}
                        >
                          {frame?.label}
                        </span>
                      </header>
                      <ImageViewer
                        frame={frame}
                        embedded
                        selectionMode
                        navigationTools={false}
                        viewport={viewport}
                        onViewportChange={setViewport}
                        markers={
                          point
                            ? [{ x: point[0], y: point[1], label: "1" }]
                            : []
                        }
                        imageOverlay={
                          point || shift ? (
                            <div
                              className="alignment-frame-values"
                              role="status"
                            >
                              {point && (
                                <>
                                  <span>X {point[0]}</span>
                                  <span>Y {point[1]}</span>
                                </>
                              )}
                              {shift && (
                                <>
                                  <span>ΔX {shift.split(/\s+/)[0]}</span>
                                  <span>ΔY {shift.split(/\s+/)[1]}</span>
                                </>
                              )}
                              {point && index >= 0 && (
                                <Button
                                  variant="destructive"
                                  size="icon-sm"
                                  aria-label={`${frame?.label} 별 선택 지우기`}
                                  disabled={measuring}
                                  title="별 선택 지우기"
                                  onClick={() => {
                                    const next = { ...points }
                                    delete next[index]
                                    setPoints(next)
                                    if (anchor && reference)
                                      onChange(
                                        shiftsFromStars(
                                          anchor,
                                          next,
                                          reference.id,
                                          frames.map((f) => f.id)
                                        )
                                      )
                                  }}
                                >
                                  <Trash2 />
                                </Button>
                              )}
                            </div>
                          ) : undefined
                        }
                        onPick={(x, y) => {
                          void measure(frame, x, y, (point) =>
                            pickStar(index, point)
                          )
                        }}
                      />
                    </section>
                  )
                })}
              </div>
            ))}
          {measurementError && (
            <p role="alert" className="px-3 py-2 text-sm text-destructive">
              {measurementError}
            </p>
          )}
          <footer className="alignment-picker-footer">
            <ViewerToolButton
              label="전체 비우기"
              variant="destructive"
              disabled={measuring || !value.trim()}
              onClick={() => {
                onChange("")
                setSelected(null)
                setAnchor(undefined)
                setPoints({})
              }}
            >
              <Trash2 />
            </ViewerToolButton>
            <Button
              size="sm"
              variant="outline"
              onClick={() => closePicker(false)}
            >
              완료
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </Field>
  )
}
