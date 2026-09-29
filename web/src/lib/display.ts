import { queryOptions } from "@tanstack/react-query"
import { api } from "./workbench"

/** One IRAF display frame held by GIRAF's image display server. */
export type DisplayFrame = {
  frame: number
  version: number
  width: number
  height: number
  title: string
  /** IIS WCS a b c d tx ty: image x = aX + cY + tx, y = bX + dY + ty. */
  transform: number[] | null
}
export type DisplayState = { current: number; frames: DisplayFrame[] }

export const displayQueryOptions = queryOptions({
  queryKey: ["display"],
  queryFn: () => api<DisplayState>("display"),
  refetchInterval: 1000,
  refetchIntervalInBackground: false,
})

export const displayFrameUrl = (frame: DisplayFrame) =>
  `/api/display-frame?frame=${frame.frame}&v=${frame.version}`

/**
 * Image pixel under a frame-buffer position (continuous, 0 at the top-left
 * corner, Y down). IIS transforms map pixel indices, i.e. pixel centres.
 */
export function displayImagePoint(frame: DisplayFrame, x: number, y: number) {
  const t = frame.transform
  if (!t) return null
  const [a, b, c, d, tx, ty] = t
  const [i, j] = [x - 0.5, y - 0.5]
  return { x: a * i + c * j + tx, y: b * i + d * j + ty }
}
