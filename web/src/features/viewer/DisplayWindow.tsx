import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { GripVertical, Maximize2, Minimize2, Minus, X } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
} from "@/components/toolbar"
import { toast } from "@/components/ui/toast"
import { ImageViewer } from "./ImageViewer"
import {
  clampDisplayBox,
  defaultDisplayBox,
  displayQueryOptions,
  displayRow,
  moveDisplayBox,
  readDisplayBox,
  resizeDisplayBox,
  saveDisplayBox,
  type DisplayBox,
  type DisplayState,
} from "@/lib/display"
import { api } from "@/lib/workbench"
import "@/styles/viewer/display.css"

type Area = { width: number; height: number }
const KEY_STEP: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
}

/**
 * IRAF's image display on the canvas: frames that display, tvmark and other
 * tasks draw, shown in the standard viewer. A movable, resizable window that
 * follows the frame IRAF last used; minimize hides it in the canvas tools.
 */
export function DisplayWindow({
  open,
  onMinimize,
}: {
  open: boolean
  onMinimize: () => void
}) {
  const queryClient = useQueryClient()
  const { data } = useQuery(displayQueryOptions)
  // A manual choice lasts until IRAF selects a frame (display, tvmark).
  const [choice, setChoice] = useState<{ frame: number; current?: number }>()
  const [expanded, setExpanded] = useState(false)
  const [saved, setSaved] = useState<DisplayBox>(
    () =>
      readDisplayBox() ??
      defaultDisplayBox(matchMedia?.("(pointer: coarse)").matches)
  )
  const [area, setArea] = useState<Area>()
  const windowRef = useRef<HTMLElement>(null)
  const gesture = useRef<{ x: number; y: number; box: DisplayBox }>(undefined)

  // The canvas can shrink (panels, window size); keep the window inside it.
  const frames = data?.frames || []
  const visible = open && frames.length > 0
  useEffect(() => {
    const canvas = windowRef.current?.parentElement
    if (!visible || !canvas) return
    const observer = new ResizeObserver(() =>
      setArea({ width: canvas.clientWidth, height: canvas.clientHeight })
    )
    observer.observe(canvas)
    return () => observer.disconnect()
  }, [visible])

  if (!frames.length) return null
  const box = area ? clampDisplayBox(saved, area) : saved
  const current = data?.current
  const chosen = choice?.current === current ? choice?.frame : undefined
  const frame =
    frames.find((f) => f.frame === (chosen ?? current)) || frames[0]
  const row = displayRow(frame)

  function begin(event: PointerEvent<HTMLElement>) {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    gesture.current = { x: event.clientX, y: event.clientY, box }
  }
  function track(
    event: PointerEvent<HTMLElement>,
    change: typeof moveDisplayBox
  ) {
    const start = gesture.current
    if (!start || !area) return
    setSaved(
      change(start.box, event.clientX - start.x, event.clientY - start.y, area)
    )
  }
  function end() {
    if (gesture.current) saveDisplayBox(box)
    gesture.current = undefined
  }
  function nudge(
    event: KeyboardEvent<HTMLElement>,
    change: typeof moveDisplayBox
  ) {
    const step = KEY_STEP[event.key]
    if (!step || !area) return
    event.preventDefault()
    const size = event.shiftKey ? 40 : 10
    const next = change(box, step[0] * size, step[1] * size, area)
    setSaved(next)
    saveDisplayBox(next)
  }
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
        ref={windowRef}
        className="display-window glass-surface"
        aria-label="IRAF 디스플레이"
        hidden={!open}
        style={box}
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
              title: (
                <ToolbarCluster edge="start" size="sm">
                  <ToolbarGroup label="창 이동">
                    <ToolbarButton
                      label="디스플레이 창 이동"
                      className="display-window-move"
                      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
                      onPointerDown={begin}
                      onPointerMove={(e) => track(e, moveDisplayBox)}
                      onPointerUp={end}
                      onPointerCancel={end}
                      onKeyDown={(e) => nudge(e, moveDisplayBox)}
                    >
                      <GripVertical />
                    </ToolbarButton>
                  </ToolbarGroup>
                  {picker}
                </ToolbarCluster>
              ),
              actions: (
                <ToolbarGroup label="창">
                  <ToolbarButton label="최소화" onClick={onMinimize}>
                    <Minus />
                  </ToolbarButton>
                  <ToolbarButton
                    label="최대화"
                    onClick={() => setExpanded(true)}
                  >
                    <Maximize2 />
                  </ToolbarButton>
                  <ToolbarButton label="디스플레이 닫기" onClick={close}>
                    <X />
                  </ToolbarButton>
                </ToolbarGroup>
              ),
            }}
          />
        </div>
        <span
          role="separator"
          tabIndex={0}
          aria-label="디스플레이 창 크기 조절"
          aria-orientation="horizontal"
          aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
          className="display-window-resize"
          onPointerDown={begin}
          onPointerMove={(e) => track(e, resizeDisplayBox)}
          onPointerUp={end}
          onPointerCancel={end}
          onKeyDown={(e) => nudge(e, resizeDisplayBox)}
        />
      </section>
      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent
          className="asset-dialog"
          aria-describedby={undefined}
          showCloseButton={false}
        >
          <div className="asset-content" data-chrome="viewer">
            <DialogTitle className="sr-only">
              IRAF 디스플레이 {row.label}
            </DialogTitle>
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
                        <span
                          className="viewer-filename glass-surface"
                          title={row.label}
                        >
                          <span>{row.label}</span>
                        </span>
                      ),
                      center: picker,
                      actions: (
                        <ToolbarGroup label="창">
                          <DialogClose
                            render={<ToolbarButton label="원래 크기로" />}
                          >
                            <Minimize2 />
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
