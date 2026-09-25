export type Point = { x: number; y: number }

/** Render ELK's orthogonal route with smoothstep's rounded corners. */
export function roundedRoute(points: Point[], radius = 5) {
  let path = `M${points[0].x},${points[0].y}`
  for (let i = 1; i < points.length - 1; i++) {
    const a = points[i - 1], b = points[i], c = points[i + 1]
    if ((a.x === b.x && b.x === c.x) || (a.y === b.y && b.y === c.y)) {
      path += ` L${b.x},${b.y}`
      continue
    }
    const before = Math.hypot(b.x - a.x, b.y - a.y)
    const after = Math.hypot(c.x - b.x, c.y - b.y)
    const r = Math.min(radius, before / 2, after / 2)
    if (!r) continue
    path += ` L${b.x + (a.x - b.x) * r / before},${b.y + (a.y - b.y) * r / before}`
    path += ` Q${b.x},${b.y} ${b.x + (c.x - b.x) * r / after},${b.y + (c.y - b.y) * r / after}`
  }
  const end = points[points.length - 1]
  return `${path} L${end.x},${end.y}`
}
