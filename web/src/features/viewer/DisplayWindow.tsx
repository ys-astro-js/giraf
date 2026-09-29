import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Maximize2, X } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { ImageViewer } from "./ImageViewer"
import { displayQueryOptions, displayRow } from "@/lib/display"
import "@/styles/viewer/display.css"

/**
 * IRAF's image display on the canvas: frames that display, tvmark and other
 * tasks draw, shown in the standard viewer. Follows the frame IRAF last used.
 */
export function DisplayWindow({ open }: { open: boolean }) {
  const { data } = useQuery(displayQueryOptions)
  // A manual choice lasts until IRAF selects a frame (display, tvmark).
  const [choice, setChoice] = useState<{ frame: number; current?: number }>()
  const [expanded, setExpanded] = useState(false)
  const frames = data?.frames || []
  if (!frames.length) return null
  const current = data?.current
  const chosen = choice?.current === current ? choice?.frame : undefined
  const frame = frames.find((f) => f.frame === (chosen ?? current)) || frames[0]
  const row = displayRow(frame)
  const picker = frames.length > 1 && (
    <ToolbarGroup label="디스플레이 프레임">
      {frames.map((f) => (
        <ToolbarButton
          key={f.frame}
          label={`프레임 ${f.frame}`}
          aria-pressed={f.frame === frame.frame}
          className="tabular-nums"
          onClick={() => setChoice({ frame: f.frame, current })}
        >
          {f.frame}
        </ToolbarButton>
      ))}
    </ToolbarGroup>
  )
  return (
    <>
      <section
        className="display-window glass-surface"
        aria-label="IRAF 디스플레이"
        hidden={!open}
      >
        <div className="viewer-grid">
          <ImageViewer
            key={row.id}
            frame={row}
            embedded
            analysis={false}
            navigationTools={false}
            revision={frame.version}
            chrome={{
              title: picker || undefined,
              actions: (
                <ToolbarGroup label="보기">
                  <ToolbarButton label="크게 보기" onClick={() => setExpanded(true)}>
                    <Maximize2 />
                  </ToolbarButton>
                </ToolbarGroup>
              ),
            }}
          />
        </div>
      </section>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="asset-dialog"
          aria-describedby={undefined}
          showCloseButton={false}
        >
          <div className="asset-content" data-chrome="viewer">
            <DialogTitle className="sr-only">IRAF 디스플레이 {row.label}</DialogTitle>
            <section aria-label="영상" className="asset-image-panel">
              <div className="viewer-workspace">
                <div className="viewer-grid">
                  <ImageViewer
                    key={row.id}
                    frame={row}
                    embedded
                    analysis={false}
                    revision={frame.version}
                    chrome={{
                      title: (
                        <span className="viewer-filename glass-surface" title={row.label}>
                          <span>{row.label}</span>
                        </span>
                      ),
                      center: picker,
                      actions: (
                        <ToolbarGroup label="닫기">
                          <DialogClose render={<ToolbarButton label="닫기" />}>
                            <X />
                          </DialogClose>
                        </ToolbarGroup>
                      ),
                    }}
                  />
                </div>
              </div>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
