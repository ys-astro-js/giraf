import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { Blank } from "@/components/workbench-controls"
import { toast } from "@/components/ui/toast"
import { usePanel } from "@/features/dock/context"
import {
  closePanel,
  registerCloseAction,
  revealPanel,
} from "@/features/dock/store"
import { WindowTitle, WindowToolbar } from "@/features/dock/WindowToolbar"
import { ImageViewer } from "./ImageViewer"
import { CursorImage } from "./CursorSession"
import {
  advance,
  cursorKeydown,
  interactiveRun,
  startSession,
  useCursorSession,
} from "@/lib/cursor-session"
import {
  displayQueryOptions,
  displayRow,
  type DisplayState,
} from "@/lib/display"
import { api, type Job } from "@/lib/workbench"
import { useLayout } from "@/features/workbench/layout-store"

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

  // Closing the window ends IRAF's display session, like closing ds9.
  useEffect(
    () =>
      panel &&
      registerCloseAction(panel.id, () => {
        api<DisplayState>("display-close", {})
          .then((state) =>
            queryClient.setQueryData(displayQueryOptions.queryKey, state)
          )
          .catch((error: Error) =>
            toast.add({ title: error.message, type: "error" })
          )
      }),
    [panel, queryClient]
  )

  const session = useCursorSession((state) => state.job)
  if (session) return <CursorImage key={session.id} job={session} />
  if (!frames.length)
    return (
      <div className="viewer-window">
        <Blank>IRAF가 표시한 영상이 없습니다</Blank>
      </div>
    )
  const current = data?.current
  const chosen = choice?.current === current ? choice?.frame : undefined
  const frame = frames.find((f) => f.frame === (chosen ?? current)) || frames[0]
  const row = displayRow(frame)
  return (
    <div className="viewer-window">
      <WindowTitle
        title={row.label}
        subtitle={`프레임 ${frame.frame}`}
        tooltip={row.label}
      />
      {frames.length > 1 && (
        <WindowToolbar>
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
        </WindowToolbar>
      )}
      <div className="viewer-grid">
        <ImageViewer
          key={row.id}
          frame={row}
          embedded
          windowBars
          analysis={false}
          revision={frame.version}
        />
      </div>
    </div>
  )
}

/**
 * Hosts an interactive run's cursor loop while it runs, as IRAF hosts imcur
 * on its image display: the display window reads the image cursor and
 * shows what the task plots, keys typed anywhere go to IRAF, and the run
 * log shows what each key did.
 */
export function CursorSessionWatcher({ job }: { job: Job | undefined }) {
  const run = interactiveRun(job) ? job! : null
  useEffect(() => {
    startSession(run)
    if (run) advance(run)
  }, [run])
  const id = run?.id
  useEffect(() => {
    if (!id) return
    revealPanel("display")
    useLayout.getState().selectLog(id)
    // Before the app's own shortcuts (capture), so a key IRAF takes stays IRAF's.
    window.addEventListener("keydown", cursorKeydown, true)
    return () => {
      window.removeEventListener("keydown", cursorKeydown, true)
      closePanel("graphics")
    }
  }, [id])
  useEffect(() => () => startSession(null), [])
  return null
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
