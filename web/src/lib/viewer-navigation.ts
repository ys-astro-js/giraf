type Point = { x: number; y: number }
type Size = { width: number; height: number }
export function pixelPosition(
  x: string,
  y: string,
  size: Size,
  subpixel = false
): Point | null {
  const px = Number(x),
    py = Number(y)
  return x.trim() &&
    y.trim() &&
    Number.isFinite(px) &&
    Number.isFinite(py) &&
    (subpixel || (Number.isInteger(px) && Number.isInteger(py))) &&
    px >= 1 &&
    py >= 1 &&
    px <= size.width &&
    py <= size.height
    ? { x: px, y: py }
    : null
}
export function stepPixel(
  point: Point | null,
  key: string,
  size: Size,
  step = 1
): Point {
  const p = point || {
    x: Math.ceil(size.width / 2),
    y: Math.ceil(size.height / 2),
  }
  return {
    x: Math.max(
      1,
      Math.min(
        size.width,
        p.x + (key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0)
      )
    ),
    y: Math.max(
      1,
      Math.min(
        size.height,
        p.y + (key === "ArrowUp" ? step : key === "ArrowDown" ? -step : 0)
      )
    ),
  }
}
export function displayNumber(value: number) {
  return String(Number(value.toPrecision(9)))
}
export function rangeValue(text: string, original: number) {
  return text === displayNumber(original)
    ? original
    : text.trim()
      ? Number(text)
      : NaN
}
export function revealOffset(node: Point & Size, view: Point & Size): Point {
  const axis = (
    start: number,
    length: number,
    scroll: number,
    space: number
  ) => {
    if (length > space - 32) return Math.max(0, start - 16)
    if (start < scroll + 16) return Math.max(0, start - 16)
    if (start + length > scroll + space - 16)
      return Math.max(0, start + length - space + 16)
    return scroll
  }
  return {
    x: axis(node.x, node.width, view.x, view.width),
    y: axis(node.y, node.height, view.y, view.height),
  }
}

export function anchoredZoom(
  scale: number,
  pan: Point,
  anchor: Point,
  view: Size,
  factor: number
) {
  const next = Math.max(0.1, Math.min(32, scale * factor))
  const ratio = next / scale
  return {
    scale: next,
    pan: {
      x:
        anchor.x - view.width / 2 - (anchor.x - view.width / 2 - pan.x) * ratio,
      y:
        anchor.y -
        view.height / 2 -
        (anchor.y - view.height / 2 - pan.y) * ratio,
    },
  }
}

/** Convert canvas position to FITS coordinates; pixel inspection still uses integer indices. */
export function imagePosition(
  point: Point,
  placement: Point & Size,
  image: Size,
  subpixel = false
): Point | null {
  if (placement.width <= 0 || placement.height <= 0) return null
  const x = ((point.x - placement.x) / placement.width) * image.width
  const y = ((point.y - placement.y) / placement.height) * image.height
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return null
  if (!subpixel)
    return { x: Math.floor(x) + 1, y: image.height - Math.floor(y) }
  return {
    x: Number(Math.max(1, Math.min(image.width, x + 0.5)).toFixed(3)),
    y: Number(
      Math.max(1, Math.min(image.height, image.height - y + 0.5)).toFixed(3)
    ),
  }
}
