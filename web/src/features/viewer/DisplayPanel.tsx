import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { X } from "lucide-react"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { Blank } from "@/components/workbench-controls"
import { toast } from "@/components/ui/toast"
import { usePanel } from "@/features/dock/context"
import { revealPanel } from "@/features/dock/store"
import { WindowControls } from "@/features/dock/WindowControls"
import { ImageViewer } from "./ImageViewer"
import {
  displayQueryOptions,
  displayRow,
  type DisplayState,
} from "@/lib/display"
import { api } from "@/lib/workbench"

/**
 * IRAF's image display: the frames that display, tvmark and other tasks
 * draw, following the frame IRAF last used.
 */
export function DisplayPanel() {
  const queryClient = useQueryClient()
  const panel = usePanel()?.panel
  const { data } = useQuery(displayQueryOptions)
  // A manual choice lasts until IRAF selects a frame (display, tvmark).
  const [choice, setChoice] = useState<{ frame: number; current?: number }>()
  const frames = data?.frames || []
  // Closing IRAF's frames closes their window too.
  const hadFrames = useRef(false)
  useEffect(() => {
    if (frames.length) hadFrames.current = true
    else if (hadFrames.current) panel?.api.close()
  }, [frames.length, panel])

  if (!frames.length)
    return (
      <div className="viewer-window">
        <div className="window-controls-row">
          <WindowControls />
        </div>
        <Blank>IRAF가 표시한 영상이 없습니다</Blank>
      </div>
    )
  const current = data?.current
  const chosen = choice?.current === current ? choice?.frame : undefined
  const frame = frames.find((f) => f.frame === (chosen ?? current)) || frames[0]
  const row = displayRow(frame)
  async function close() {
    try {
      queryClient.setQueryData<DisplayState>(
        displayQueryOptions.queryKey,
        await api<DisplayState>("display-close", {})
      )
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  return (
    <div className="viewer-window">
      <div className="viewer-grid">
        <ImageViewer
          key={row.id}
          frame={row}
          embedded
          analysis={false}
          revision={frame.version}
          chrome={{
            title: (
              <span className="viewer-title-row">
                <WindowControls />
                <span
                  className="viewer-filename glass-surface"
                  title={row.label}
                >
                  <span>{row.label}</span>
                </span>
              </span>
            ),
            center: frames.length > 1 && (
              <ToolbarGroup label="디스플레이 프레임" size="sm">
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
            ),
            actions: (
              <ToolbarGroup label="디스플레이">
                <ToolbarButton label="디스플레이 프레임 닫기" onClick={close}>
                  <X />
                </ToolbarButton>
              </ToolbarGroup>
            ),
          }}
        />
      </div>
    </div>
  )
}

/** Opens the display window when IRAF first draws into it. */
export function DisplayWatcher() {
  const { data } = useQuery(displayQueryOptions)
  const count = data?.frames.length ?? 0
  const previous = useRef(count)
  useEffect(() => {
    if (count && !previous.current) revealPanel("display", { activate: false })
    previous.current = count
  }, [count])
  return null
}
