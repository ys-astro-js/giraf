import { apiQueryOptions } from "./queries"

export type ImageInfo = {
  width: number
  height: number
  mean: number
  median: number
  std: number
  min: number
  max: number
  low: number
  high: number
  header: string
}

export type Pixel = {
  x: number
  y: number
  value: number
  row: (number | null)[]
  column: (number | null)[]
}

export function imageInfoQueryOptions(id: string | undefined) {
  return {
    ...apiQueryOptions<ImageInfo>(`info?id=${encodeURIComponent(id ?? "")}`),
    enabled: !!id,
    // File IDs identify paths, so reopening must check for changed contents.
    staleTime: 0,
  }
}

export function pixelQueryOptions(id: string | undefined, x: number, y: number) {
  return {
    ...apiQueryOptions<Pixel>(`pixel?id=${encodeURIComponent(id ?? "")}&x=${x}&y=${y}`),
    enabled: !!id,
    // Each response contains full row/column profiles; discard unused pixels.
    gcTime: 0,
    staleTime: 0,
  }
}
