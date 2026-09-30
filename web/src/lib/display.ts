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
