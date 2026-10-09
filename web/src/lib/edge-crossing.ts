import type { Point } from "./edge-routing"

type Rect = { x: number; y: number; width: number; height: number }

/** Points along an SVG path of absolute M, L, C and Q commands, as React Flow and roundedRoute draw edges. */
export function pathPoints(d: string, steps = 24): Point[] {
  const tokens = d.match(/[MLCQ]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/gi) ?? []
  const points: Point[] = []
  let command = "", i = 0
  const read = () => ({ x: Number(tokens[i++]), y: Number(tokens[i++]) })
  while (i < tokens.length) {
    if (/^[MLCQ]$/i.test(tokens[i])) command = tokens[i++].toUpperCase()
    const from = points.at(-1) ?? { x: 0, y: 0 }
    if (command === "M" || command === "L") points.push(read())
    else if (command === "C" || command === "Q") {
      const controls = command === "C" ? [read(), read()] : [read()]
      const to = read()
      for (let k = 1; k <= steps; k++) {
        const t = k / steps, u = 1 - t
        points.push(command === "C"
          ? {
              x: u * u * u * from.x + 3 * u * u * t * controls[0].x + 3 * u * t * t * controls[1].x + t * t * t * to.x,
              y: u * u * u * from.y + 3 * u * u * t * controls[0].y + 3 * u * t * t * controls[1].y + t * t * t * to.y,
            }
          : {
              x: u * u * from.x + 2 * u * t * controls[0].x + t * t * to.x,
              y: u * u * from.y + 2 * u * t * controls[0].y + t * t * to.y,
            })
      }
    } else i++
  }
  return points
}

const inside = (p: Point, r: Rect) => p.x > r.x && p.x < r.x + r.width && p.y > r.y && p.y < r.y + r.height

/** Where a path last enters a rectangle, on its border; undefined when it never does. */
export function borderCrossing(points: Point[], rect: Rect): Point | undefined {
  return entering(points, rect)?.at
}

function entering(points: Point[], rect: Rect): { at: Point; index: number } | undefined {
  for (let k = points.length - 1; k > 0; k--) {
    const a = points[k - 1], b = points[k]
    if (inside(a, rect) || !inside(b, rect)) continue
    // The segment's first point on the rectangle's border.
    let best: Point | undefined, bestT = Infinity
    const dx = b.x - a.x, dy = b.y - a.y
    for (const [edge, vertical] of [[rect.x, true], [rect.x + rect.width, true], [rect.y, false], [rect.y + rect.height, false]] as const) {
      const span = vertical ? dx : dy
      if (!span) continue
      const t = (edge - (vertical ? a.x : a.y)) / span
      if (t < 0 || t > 1 || t >= bestT) continue
      const p = { x: a.x + dx * t, y: a.y + dy * t }
      const along = vertical ? p.y >= rect.y && p.y <= rect.y + rect.height : p.x >= rect.x && p.x <= rect.x + rect.width
      if (along) {
        best = p
        bestT = t
      }
    }
    return { at: best ?? b, index: k }
  }
  return undefined
}

export type Box = { x: number; y: number; width: number; height: number }
const overlaps = (a: Box, b: Box) =>
  Math.abs(a.x - b.x) * 2 < a.width + b.width && Math.abs(a.y - b.y) * 2 < a.height + b.height

/**
 * A chip's center on a path where it enters `rect`: on the border, or moved
 * along the path into the rectangle until it clears the chips already placed
 * (centered boxes), so chips of edges entering side by side stay readable.
 */
export function chipPlace(points: Point[], rect: Rect, size: { width: number; height: number }, taken: Box[]): Point | undefined {
  const start = entering(points, rect)
  if (!start) return undefined
  const box = (p: Point) => ({ ...p, ...size })
  if (!taken.some((t) => overlaps(box(start.at), t))) return start.at
  let previous = start.at, walked = 0
  for (let k = start.index; k < points.length; k++) {
    const p = points[k]
    walked += Math.hypot(p.x - previous.x, p.y - previous.y)
    previous = p
    if (walked > 160) break
    if (!taken.some((t) => overlaps(box(p), t))) return p
  }
  return start.at
}
