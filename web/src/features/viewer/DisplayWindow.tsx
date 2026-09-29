import { useState, type MouseEvent, type ReactNode } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronDown, ChevronUp, Maximize2 } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ViewerToolButton } from "./controls"
import {
  displayFrameUrl,
  displayImagePoint,
  displayQueryOptions,
  type DisplayFrame,
} from "@/lib/display"
import "@/styles/viewer/display.css"

/**
 * IRAF's image display inside GIRAF: frames written by display, tvmark and
 * other tasks. Appears once IRAF draws, and follows the frame IRAF last used.
 */
export function DisplayWindow() {
  const { data } = useQuery(displayQueryOptions)
  // A manual choice lasts until IRAF selects a frame (display, tvmark).
  const [choice, setChoice] = useState<{ frame: number; current?: number }>()
  const [collapsed, setCollapsed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const current = data?.current
  const chosen = choice?.current === current ? choice?.frame : undefined
  const frames = data?.frames || []
  if (!frames.length) return null
  const frame =
    frames.find((f) => f.frame === (chosen ?? current)) || frames[0]
  const picker = (
    <ToggleGroup
      value={[String(frame.frame)]}
      onValueChange={(value) => value[0] && setChoice({ frame: Number(value[0]), current })}
      size="sm"
      aria-label="디스플레이 프레임"
      className="display-frames"
    >
      {frames.map((f) => (
        <ToggleGroupItem key={f.frame} value={String(f.frame)} aria-label={`프레임 ${f.frame}`}>
          {f.frame}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
  return (
    <section className="display-window glass-surface" aria-label="IRAF 디스플레이">
      <header className="display-window-header">
        <span className="display-live" aria-hidden="true" />
        <span className="display-window-name">디스플레이</span>
        {picker}
        <span className="ml-auto flex">
          <ViewerToolButton label="크게 보기" onClick={() => setExpanded(true)}>
            <Maximize2 />
          </ViewerToolButton>
          <ViewerToolButton
            label={collapsed ? "펼치기" : "접기"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((v) => !v)}
          >
            {collapsed ? <ChevronUp /> : <ChevronDown />}
          </ViewerToolButton>
        </span>
      </header>
      {!collapsed && (
        <button
          type="button"
          className="display-window-image"
          aria-label={`프레임 ${frame.frame} 크게 보기`}
          title={frame.title}
          onClick={() => setExpanded(true)}
        >
          <img src={displayFrameUrl(frame)} alt="" draggable={false} />
        </button>
      )}
      {expanded && (
        <DisplayDialog frame={frame} picker={picker} onClose={() => setExpanded(false)} />
      )}
    </section>
  )
}

function DisplayDialog({
  frame,
  picker,
  onClose,
}: {
  frame: DisplayFrame
  picker: ReactNode
  onClose: () => void
}) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null)
  function track(event: MouseEvent<HTMLImageElement>) {
    // object-fit: contain letterboxes the frame inside the element box.
    const box = event.currentTarget.getBoundingClientRect()
    const scale = Math.min(box.width / frame.width, box.height / frame.height)
    const x = (event.clientX - box.left - (box.width - frame.width * scale) / 2) / scale
    const y = (event.clientY - box.top - (box.height - frame.height * scale) / 2) / scale
    const inside = x >= 0 && y >= 0 && x < frame.width && y < frame.height
    setPoint(inside ? displayImagePoint(frame, x, y) : null)
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="display-dialog" aria-describedby={undefined}>
        <header className="display-dialog-header">
          <DialogTitle>디스플레이</DialogTitle>
          {picker}
          <span className="truncate text-muted-foreground" title={frame.title}>
            {frame.title}
          </span>
        </header>
        <div className="display-dialog-image">
          <img
            src={displayFrameUrl(frame)}
            alt={`디스플레이 프레임 ${frame.frame}`}
            draggable={false}
            onMouseMove={track}
            onMouseLeave={() => setPoint(null)}
          />
        </div>
        <footer className="display-dialog-footer tabular-nums" aria-live="off">
          {point ? `x ${point.x.toFixed(1)}  y ${point.y.toFixed(1)}` : "영상 위에 포인터를 올리면 픽셀 좌표를 표시합니다."}
        </footer>
      </DialogContent>
    </Dialog>
  )
}
