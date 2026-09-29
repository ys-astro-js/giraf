import type { ImageInfo } from "@/lib/image-queries"
import type { ViewerMarker } from "./types"
type Point = { x: number; y: number }
type Size = { width: number; height: number }
type Placement = Point & { w: number; h: number }

export function drawImageViewport({
  canvas,
  image,
  info,
  size,
  scale,
  pan,
  cross,
  markers,
  selectedMarker,
}: {
  canvas: HTMLCanvasElement | null
  image: HTMLImageElement | null
  info: ImageInfo | undefined
  size: Size
  scale: number
  pan: Point
  cross: Point | null
  markers: ViewerMarker[]
  selectedMarker: string | undefined
}) {
  if (!canvas) return
  const c = canvas
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
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image, x, y, w, h)
  drawCrosshair(ctx, info, { x, y, w, h }, cross)
  drawMarkers(ctx, info, { x, y, w, h }, markers, selectedMarker)
  return { x, y, w, h }
}

function drawCrosshair(
  ctx: CanvasRenderingContext2D,
  info: ImageInfo,
  { x, y, w, h }: Placement,
  cross: Point | null
) {
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
}

function drawMarkers(
  ctx: CanvasRenderingContext2D,
  info: ImageInfo,
  { x, y, w, h }: Placement,
  markers: ViewerMarker[],
  selectedMarker: string | undefined
) {
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
}
