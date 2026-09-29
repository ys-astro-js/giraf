import type { ViewerMarker } from "./types"

export function drawTvmark(
  ctx: CanvasRenderingContext2D,
  marker: ViewerMarker,
  previous: ViewerMarker | undefined,
  placement: { x: number; y: number; w: number; h: number },
  info: { width: number; height: number },
) {
  const style = marker.appearance!
  const sx = placement.w / info.width, sy = placement.h / info.height
  const x = placement.x + (marker.x - .5) * sx
  const y = placement.y + (info.height - marker.y + .5) * sy
  ctx.save()
  ctx.strokeStyle = ctx.fillStyle = style.color
  ctx.lineWidth = 1
  ctx.beginPath()
  switch (style.shape) {
    case "point":
      ctx.fillRect(x - style.pointSize / 2, y - style.pointSize / 2, style.pointSize, style.pointSize)
      break
    case "circle":
      for (const radius of style.sizes) {
        ctx.beginPath()
        ctx.arc(x, y, radius * sx, 0, 2 * Math.PI)
        ctx.stroke()
      }
      break
    case "rectangle":
      for (const length of style.sizes) ctx.strokeRect(x - length * sx / 2, y - length * style.ratio * sy / 2, length * sx, length * style.ratio * sy)
      break
    case "line":
      if (previous) {
        ctx.moveTo(placement.x + (previous.x - .5) * sx, placement.y + (info.height - previous.y + .5) * sy)
        ctx.lineTo(x, y)
        ctx.stroke()
      }
      break
    case "plus":
    case "cross": {
      const size = 3 * style.textSize
      const diagonal = style.shape === "cross"
      ctx.moveTo(x - size, y - (diagonal ? size : 0))
      ctx.lineTo(x + size, y + (diagonal ? size : 0))
      ctx.moveTo(x + (diagonal ? size : 0), y - size)
      ctx.lineTo(x - (diagonal ? size : 0), y + size)
      ctx.stroke()
      break
    }
  }
  if (marker.label) {
    ctx.font = `${7 * style.textSize}px monospace`
    ctx.fillText(marker.label, x + style.offsetX, y - style.offsetY)
  }
  ctx.restore()
}
