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

/**
 * The IRAF image pixel shown at a frame position (1-based, y up), by the IIS
 * WCS the task that drew the frame set; null for a frame without one.
 */
export function frameToImage(frame: DisplayFrame, x: number, y: number) {
  if (!frame.transform) return null
  const [a, b, c, d, tx, ty] = frame.transform
  const column = x - 1,
    row = frame.height - y
  return {
    x: Math.round((a * column + c * row + tx) * 100) / 100,
    y: Math.round((b * column + d * row + ty) * 100) / 100,
  }
}
