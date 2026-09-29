export type ViewerViewport = { scale: number; x: number; y: number }
export type MarkerAppearance = {
  shape: "point" | "circle" | "rectangle" | "line" | "plus" | "cross" | "none"
  sizes: number[]
  ratio: number
  color: string
  pointSize: number
  textSize: number
  offsetX: number
  offsetY: number
}
export type ViewerMarker = { x: number; y: number; label: string; appearance?: MarkerAppearance }
