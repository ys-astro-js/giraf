import type { ReactNode } from "react"
export type ViewerViewport = { scale: number; x: number; y: number }
export type ViewerMarker = { x: number; y: number; label: string }

export type ViewerChrome = {
  title?: ReactNode
  center?: ReactNode
  actions?: ReactNode
}
