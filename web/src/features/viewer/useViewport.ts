import { useEffect, useRef, useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { imageInfoQueryOptions, pixelQueryOptions } from "@/lib/image-queries"
import {
  anchoredZoom,
  displayNumber,
  imagePosition,
  pixelPosition,
  rangeValue,
} from "@/lib/viewer-navigation"
import type { Frame } from "@/lib/workbench"
import type { ViewerViewport, ViewerMarker } from "./types"
import { drawImageViewport } from "./rendering"

export function useImageViewport({
  onPick,
  selectionMode,
  frame,
  viewport,
  onViewportChange,
  sharedRange,
  markers,
  selectedMarker,
}: {
  onPick: ((x: number, y: number) => void) | undefined
  selectionMode: boolean
  frame: Frame | undefined
  viewport: ViewerViewport | undefined
  onViewportChange: ((viewport: ViewerViewport) => void) | undefined
  sharedRange: [number, number] | undefined
  markers: ViewerMarker[]
  selectedMarker: string | undefined
}) {
  const [rangeError, setRangeError] = useState("")
  const [coordinatesOpen, setCoordinatesOpen] = useState(
    !!onPick && !selectionMode
  )
  const [retry, setRetry] = useState(0)
  const [imageLoading, setLoading] = useState(false)
  const [coordinates, setCoordinates] = useState<[string, string]>(["", ""]),
    [coordinateError, setCoordinateError] = useState("")
  const [imageError, setError] = useState(""),
    [stretch, setStretch] = useState("asinh"),
    [editedRange, setRange] = useState<[string, string] | null>(null),
    [applied, setApplied] = useState<[number, number] | null>(null)
  const [pixelSelection, setPixelSelection] = useState<{
    id: string
    x: number
    y: number
  } | null>(null)
  const infoQuery = useQuery(imageInfoQueryOptions(frame?.id))
  const pixelQuery = useQuery(
    pixelQueryOptions(
      !onPick && pixelSelection?.id === frame?.id
        ? pixelSelection?.id
        : undefined,
      pixelSelection?.x ?? 0,
      pixelSelection?.y ?? 0
    )
  )
  const info = infoQuery.data
  const range: [string, string] =
    editedRange ??
    (info ? [displayNumber(info.low), displayNumber(info.high)] : ["", ""])
  const pixel =
    pixelSelection?.id === frame?.id && !onPick ? pixelQuery.data : undefined
  const error =
    infoQuery.error?.message || pixelQuery.error?.message || imageError
  const loading = !!frame && (infoQuery.isLoading || imageLoading)
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
  const cursorGuidesRef = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null),
    box = useRef<HTMLDivElement>(null),
    placement = useRef({ x: 0, y: 0, w: 0, h: 0 }),
    dragRef = useRef<{
      x: number
      y: number
      startX: number
      startY: number
    } | null>(null)
  useEffect(() => {
    if (cursorGuidesRef.current) cursorGuidesRef.current.hidden = true
    setCoordinates(["", ""])
    setCoordinateError("")
    setLoading(false)
    setImage(null)
    setPixelSelection(null)
    setCross(null)
    setLocalScale(1)
    setLocalPan({ x: 0, y: 0 })
    setApplied(null)
    setRange(null)
    setRangeError("")
    setError("")
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
  }, [frame?.id, info, stretch, applied, sharedRange, retry])
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
    const drawn = drawImageViewport({
      canvas: canvas.current,
      image,
      info,
      size,
      scale,
      pan,
      cross,
      markers,
      selectedMarker,
    })
    if (drawn) placement.current = drawn
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
    if (onPick) {
      if (commit) onPick(x, y)
      return
    }
    setPixelSelection({ id: frame.id, x, y })
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

  function changeRange(index: number, value: string) {
    setRange((previous) => {
      const current = previous ?? range
      return index === 0 ? [value, current[1]] : [current[0], value]
    })
    setRangeError("")
  }
  function applyRange() {
    if (!info || sharedRange) return
    const low = rangeValue(range[0], info.low)
    const high = rangeValue(range[1], info.high)
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
      setRangeError("최댓값은 최솟값보다 커야 합니다.")
      return
    }
    setRangeError("")
    setApplied([low, high])
  }
  function resetRange() {
    if (!info || sharedRange) return
    setApplied(null)
    setRange([displayNumber(info.low), displayNumber(info.high)])
    setRangeError("")
  }
  function changeCoordinate(index: number, value: string) {
    setCoordinates((current) =>
      index === 0 ? [value, current[1]] : [current[0], value]
    )
    setCoordinateError("")
  }
  function submitCoordinates() {
    if (!info) return
    const point = pixelPosition(...coordinates, info, selectionMode)
    if (!point) {
      setCoordinateError(
        `X는 1–${info.width}, Y는 1–${info.height} 범위로 입력해 주세요.`
      )
      return
    }
    inspect(point.x, point.y, true)
    setCoordinatesOpen(false)
  }
  function retryImage() {
    setError("")
    setRetry((value) => value + 1)
    void infoQuery.refetch()
  }

  return {
    info,
    box,
    canvas,
    cross,
    inspect,
    size,
    scale,
    pan,
    setPan,
    dragRef,
    cursorGuidesRef,
    image,
    pick,
    range,
    applyRange,
    resetRange,
    stretch,
    setStretch,
    rangeError,
    changeRange,
    pixel,
    zoom,
    actualScale,
    reset,
    coordinatesOpen,
    setCoordinatesOpen,
    coordinates,
    submitCoordinates,
    coordinateError,
    changeCoordinate,
    loading,
    error,
    retryImage,
  }
}
