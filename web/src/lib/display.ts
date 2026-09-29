import { queryOptions } from "@tanstack/react-query"
import { api, type Frame } from "./workbench"

/** One IRAF display frame held by GIRAF's image display server. */
export type DisplayFrame = {
  frame: number
  version: number
  width: number
  height: number
  title: string
  transform: number[] | null
}
export type DisplayState = { current: number; frames: DisplayFrame[] }

export const displayQueryOptions = queryOptions({
  queryKey: ["display"],
  queryFn: () => api<DisplayState>("display"),
  refetchInterval: 1000,
  refetchIntervalInBackground: false,
})

/** Display frames open in the standard image viewer as `display:N` assets. */
export const displayRow = (frame: DisplayFrame): Frame => ({
  id: `display:${frame.frame}`,
  label: frame.title || `프레임 ${frame.frame}`,
  asset: "image",
})

/** The floating window, anchored to the canvas's bottom-right corner. */
export type DisplayBox = { right: number; bottom: number; width: number; height: number }
type Area = { width: number; height: number }
const INSET = 12
/** Fits the move grip, two frame buttons and the window controls without overlap. */
export const DISPLAY_MIN_SIZE = { width: 256, height: 200 }
/** Above the minimap: 46px zoom row + 80px minimap + 8px gap + 12px inset. */
export const defaultDisplayBox = (coarse = false): DisplayBox => ({
  right: INSET,
  bottom: coarse ? 158 : 146,
  width: 256,
  height: 256,
})

const within = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), Math.max(low, high))

/** Keeps the whole window inside the canvas, shrinking it if the canvas is smaller. */
export function clampDisplayBox(box: DisplayBox, area: Area): DisplayBox {
  const width = within(box.width, DISPLAY_MIN_SIZE.width, area.width - 2 * INSET)
  const height = within(box.height, DISPLAY_MIN_SIZE.height, area.height - 2 * INSET)
  return {
    width,
    height,
    right: within(box.right, INSET, area.width - INSET - width),
    bottom: within(box.bottom, INSET, area.height - INSET - height),
  }
}

export const moveDisplayBox = (box: DisplayBox, dx: number, dy: number, area: Area) =>
  clampDisplayBox({ ...box, right: box.right - dx, bottom: box.bottom - dy }, area)

/** The bottom-right grip: the top-left corner stays where it is. */
export function resizeDisplayBox(box: DisplayBox, dx: number, dy: number, area: Area) {
  const maxWidth = area.width - INSET - (area.width - box.right - box.width)
  const maxHeight = area.height - INSET - (area.height - box.bottom - box.height)
  const width = within(box.width + dx, DISPLAY_MIN_SIZE.width, maxWidth)
  const height = within(box.height + dy, DISPLAY_MIN_SIZE.height, maxHeight)
  return clampDisplayBox(
    { width, height, right: box.right - (width - box.width), bottom: box.bottom - (height - box.height) },
    area
  )
}

const boxKey = "giraf-display-window"
export function readDisplayBox(storage?: Pick<Storage, "getItem">): DisplayBox | undefined {
  try {
    const value = JSON.parse((storage ?? localStorage).getItem(boxKey) || "null")
    const keys = ["right", "bottom", "width", "height"] as const
    if (value && keys.every((key) => Number.isFinite(value[key]))) return value as DisplayBox
  } catch {
    // Storage may be unavailable; the window then opens at its default place.
  }
  return undefined
}
export function saveDisplayBox(box: DisplayBox, storage?: Pick<Storage, "setItem">) {
  try {
    ;(storage ?? localStorage).setItem(boxKey, JSON.stringify(box))
  } catch {
    // Moving and resizing still work without browser storage.
  }
}
