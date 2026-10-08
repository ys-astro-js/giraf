import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Check,
  Ellipsis,
  Eye,
  List,
  Maximize2,
  Minimize2,
  Minus,
  PictureInPicture2,
  Plus,
  RefreshCw,
  Save,
  Sigma,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
} from "@/components/toolbar"
import {
  closePanel,
  floatPanel,
  useWindowShown,
} from "@/features/dock/store"
import { WindowTitle, WindowToolbar } from "@/features/dock/WindowToolbar"
import { ImageViewer } from "./ImageViewer"
import { ViewerPopover } from "./controls"
import {
  finish,
  moveCursor,
  openCommand,
  pressKey,
  useCursorSession,
  waitingCursor,
  type CursorIcon,
  type Point,
} from "@/lib/cursor-session"
import { displayQueryOptions, displayRow, frameToImage } from "@/lib/display"
import type { Job } from "@/lib/workbench"

/** The node schema's cursor icons (giraf/node_schema.py CURSOR_ICONS). */
const ICONS = {
  check: Check,
  trash: Trash2,
  sigma: Sigma,
  save: Save,
  plus: Plus,
  minus: Minus,
  refresh: RefreshCw,
  list: List,
  eye: Eye,
  x: X,
} satisfies Record<CursorIcon, unknown>
function CursorSymbol({ icon }: { icon?: CursorIcon }) {
  const Icon = ICONS[icon ?? "check"]
  return <Icon />
}

/** The request the run waits on, and whether it was already answered. */
function useRequest(job: Job | null | undefined) {
  const answered = useCursorSession((state) => state.answered)
  const interaction = waitingCursor(job ?? undefined)
  return { interaction, busy: !interaction || answered === interaction.id }
}

/**
 * Every key the task's own IRAF help lists for one cursor, for people who
 * know IRAF. Keys can also be typed directly.
 */
function CursorMoreMenu({
  job,
  cursor,
  disabled,
}: {
  job: Job
  cursor: "image" | "graphics"
  disabled: boolean
}) {
  const group = job.manifest?.cursorKeys?.find((g) => g.cursor === cursor)
  if (!group?.keys.length) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<ToolbarButton label="IRAF 키" />}>
        <Ellipsis />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-(--available-height)">
        <DropdownMenuGroup>
          {group.keys.map((k) => (
            <DropdownMenuItem
              key={k.key}
              disabled={disabled}
              onClick={() => pressKey(job, k.key)}
            >
              {k.description}
              <kbd className="ml-auto pl-4 font-mono text-muted-foreground">
                {k.key}
              </kbd>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** IRAF's colon commands (`:psfrad 4`), for whichever cursor is reading. */
function CommandField({
  job,
  disabled,
  anchor,
}: {
  job: Job
  disabled: boolean
  anchor: React.RefObject<HTMLElement | null>
}) {
  const open = useCursorSession((state) => state.command)
  const [text, setText] = useState("")
  const kind = waitingCursor(job)?.kind === "gcur" ? "graphics" : "image"
  const colon = job.manifest?.cursorKeys?.find((g) => g.cursor === kind)?.colon
  const list = `colon-${job.id}`
  return (
    <ViewerPopover
      label="IRAF 명령 (:)"
      icon={SquareTerminal}
      disabled={disabled}
      open={open && !disabled}
      onOpenChange={openCommand}
      heading={false}
      anchor={anchor}
      className="w-64 p-1.5"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          const command = text.trim().replace(/^:/, "")
          if (!command) return
          pressKey(job, ":", undefined, command)
          setText("")
          openCommand(false)
        }}
      >
        <Input
          aria-label="IRAF 명령"
          list={colon?.length ? list : undefined}
          value={text}
          spellCheck={false}
          autoComplete="off"
          className="font-mono"
          onChange={(e) => setText(e.target.value)}
        />
        {!!colon?.length && (
          <datalist id={list}>
            {colon.map((c) => (
              <option key={c.command} value={c.command}>
                {c.description}
              </option>
            ))}
          </datalist>
        )}
      </form>
    </ViewerPopover>
  )
}

/** Reject and accept for the plot IRAF asks about, on the plot itself. */
function GraphicsActions({ job }: { job: Job }) {
  const { interaction, busy } = useRequest(job)
  const reading = interaction?.kind === "gcur"
  const graphics = job.manifest?.cursor?.graphics
  return (
    <>
      <ToolbarGroup label="IRAF 그래픽 커서" hidden={!reading}>
        <CursorMoreMenu job={job} cursor="graphics" disabled={busy} />
        {graphics?.reject && (
          <ToolbarButton
            label={`${graphics.reject.label} (${graphics.reject.key})`}
            disabled={busy}
            onClick={() => pressKey(job, graphics.reject!.key)}
          >
            <CursorSymbol icon={graphics.reject.icon ?? "trash"} />
          </ToolbarButton>
        )}
      </ToolbarGroup>
      {graphics?.accept && (
        <ToolbarGroup label={graphics.accept.label} hidden={!reading}>
          <ToolbarButton
            prominent
            label={`${graphics.accept.label} (${graphics.accept.key})`}
            disabled={busy}
            onClick={() => pressKey(job, graphics.accept!.key)}
          >
            <CursorSymbol icon={graphics.accept.icon} />
          </ToolbarButton>
        </ToolbarGroup>
      )}
    </>
  )
}

function GraphicsPlot({ job, plotted }: { job: Job; plotted: string }) {
  const title = job.manifest?.cursor?.graphics?.title ?? "IRAF 그래픽"
  return (
    <img
      className="asset-plot"
      src={`/api/task-graphics?id=${encodeURIComponent(job.id)}&request=${plotted}`}
      alt={title}
      draggable={false}
    />
  )
}

/**
 * The task's plot as a picture-in-picture over the image it came from: it
 * moves anywhere in the window, grows to fill it, or goes out as a window
 * of its own (IRAF's graphics window).
 */
function GraphicsPip({
  job,
  plotted,
  hidden,
  onClose,
}: {
  job: Job
  plotted: string
  hidden: boolean
  onClose: () => void
}) {
  const [grown, setGrown] = useState(false)
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 })
  const [size, setSize] = useState<{ width: number; height: number }>()
  // Moving, or resizing from the edges away from its resting corner.
  const drag = useRef<{
    x: number
    y: number
    from: Point
    room: DOMRect
    edge?: { left: boolean; top: boolean; width: number; height: number }
  }>(null)
  const box = useRef<HTMLDivElement>(null)
  const clamp = (v: number, min: number, max: number) =>
    Math.min(Math.max(v, min), Math.max(min, max))
  return (
    <div
      ref={box}
      className="cursor-pip"
      hidden={hidden}
      data-grown={grown || undefined}
      style={
        grown
          ? undefined
          : {
              translate: `${offset.x}px ${offset.y}px`,
              ...(size && { ...size, aspectRatio: "auto" }),
            }
      }
      onPointerDown={(e) => {
        const target = e.target as HTMLElement
        if (grown || target.closest("button")) return
        const self = box.current!.getBoundingClientRect()
        const area = box.current!.parentElement!.getBoundingClientRect()
        const handle = target.dataset.resize
        drag.current = {
          x: e.clientX,
          y: e.clientY,
          from: offset,
          // How far it may travel from where it rests, staying in the window.
          room: new DOMRect(
            area.left - self.left + offset.x,
            area.top - self.top + offset.y,
            area.width - self.width,
            area.height - self.height
          ),
          edge: handle
            ? {
                left: handle !== "top",
                top: handle !== "left",
                // Up to the window's edges from its fixed corner.
                width: self.right - area.left,
                height: self.bottom - area.top,
              }
            : undefined,
        }
        e.currentTarget.setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d) return
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        if (d.edge) {
          const self = box.current!.getBoundingClientRect()
          const start = { width: self.width, height: self.height }
          d.x = e.clientX
          d.y = e.clientY
          setSize({
            width: d.edge.left
              ? clamp(start.width - dx, 240, d.edge.width)
              : start.width,
            height: d.edge.top
              ? clamp(start.height - dy, 180, d.edge.height)
              : start.height,
          })
          return
        }
        setOffset({
          x: clamp(d.from.x + dx, d.room.x, d.room.x + d.room.width),
          y: clamp(d.from.y + dy, d.room.y, d.room.y + d.room.height),
        })
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
    >
      {!grown && (
        <>
          <span className="cursor-pip-resize" data-resize="top" />
          <span className="cursor-pip-resize" data-resize="left" />
          <span className="cursor-pip-resize" data-resize="corner" />
        </>
      )}
      <div className="cursor-pip-bar">
        <span className="window-pill" data-active>
          <ToolbarCluster edge="start" className="window-pill-cluster">
            <ToolbarGroup label="그래픽 조작">
              <ToolbarButton label="닫기" onClick={onClose}>
                <X />
              </ToolbarButton>
              <ToolbarButton
                label={grown ? "작게" : "크게"}
                onClick={() => setGrown(!grown)}
              >
                {grown ? <Minimize2 /> : <Maximize2 />}
              </ToolbarButton>
              <ToolbarButton label="분리" onClick={() => floatPanel("graphics")}>
                <PictureInPicture2 />
              </ToolbarButton>
            </ToolbarGroup>
          </ToolbarCluster>
        </span>
        <ToolbarCluster edge="end" size="sm">
          <GraphicsActions job={job} />
        </ToolbarCluster>
      </div>
      <GraphicsPlot job={job} plotted={plotted} />
    </div>
  )
}

/**
 * What IRAF printed in answer to the last key (a star it could not find, a
 * star it added), shown for a moment where IRAF's own status line would
 * be. The output before the first request is the task starting up.
 */
function useReply(interaction: Job["interaction"] | undefined) {
  const [reply, setReply] = useState<{ id: string; text: string }>()
  const first = useRef<string>(undefined)
  const id = interaction?.id
  const text = interaction?.prompt?.trim()
  useEffect(() => {
    if (!id) return
    first.current ??= id
    if (id === first.current || !text) return setReply(undefined)
    setReply({ id, text })
    const timer = setTimeout(() => setReply(undefined), 5000)
    return () => clearTimeout(timer)
  }, [id, text])
  return reply
}

/**
 * The image cursor of an interactive run, in the IRAF display: the frame
 * the user displayed (or the task's image), the marks the task accepted,
 * the task's named steps, and its plot in the corner while it has one.
 * Clicking a star sends the schema's click key there; keys typed anywhere
 * go to IRAF at the image cursor (cursorKeydown).
 */
export function CursorImage({ job }: { job: Job }) {
  const cursor = job.manifest?.cursor
  const { interaction, busy } = useRequest(job)
  const reading = interaction?.kind === "imcur"
  const asking = interaction?.kind === "gcur" && !busy
  const commandAnchor = useRef<HTMLDivElement>(null)
  const used = useCursorSession((state) => state.used)
  const pending = useCursorSession((state) => state.pending)
  const plotted = useCursorSession((state) => state.plotted)
  const [closed, setClosed] = useState("")
  const outside = useWindowShown("graphics")
  const { data: display } = useQuery(displayQueryOptions)
  const shown =
    display?.frames.find((f) => f.frame === display.current) ??
    display?.frames[0]
  const frame = shown
    ? displayRow(shown)
    : job.manifest?.rows.find((row) => row.id === job.manifest?.cursorImage)

  function place(view: Point) {
    const image = shown ? frameToImage(shown, view.x, view.y) : view
    return { view, image: image ?? undefined }
  }
  const image = cursor?.image
  const subtitle = !interaction
    ? "IRAF 처리 중"
    : used.length && image?.count
      ? image.count.replace("{n}", String(used.length))
      : undefined
  const reply = useReply(interaction)
  const commandOpen = useCursorSession((state) => state.command)
  const markers = [
    ...used.map((p, i) => ({ ...p, label: String(i + 1) })),
    ...(pending ? [{ ...pending, label: String(used.length + 1) }] : []),
  ]
  return (
    <div className="viewer-window relative" aria-busy={busy}>
      <WindowTitle
        title={frame?.label}
        subtitle={subtitle}
        tooltip={frame?.label}
      />
      <WindowToolbar>
        <ToolbarGroup label="IRAF 커서">
          <CursorMoreMenu job={job} cursor="image" disabled={!reading || busy} />
          <CommandField job={job} disabled={busy} anchor={commandAnchor} />
          {image?.actions?.map((a) => (
            <ToolbarButton
              key={a.key}
              label={`${a.label} (${a.key})`}
              disabled={!reading || busy}
              onClick={() => pressKey(job, a.key)}
            >
              <CursorSymbol icon={a.icon} />
            </ToolbarButton>
          ))}
        </ToolbarGroup>
        {image?.finish && (
          <ToolbarGroup label={image.finish.label}>
            <ToolbarButton
              prominent
              label={image.finish.label}
              disabled={!reading || busy}
              onClick={() => finish(job, image.finish!.keys)}
            >
              <CursorSymbol icon={image.finish.icon} />
            </ToolbarButton>
          </ToolbarGroup>
        )}
      </WindowToolbar>
      <div className="viewer-grid">
        <ImageViewer
          key={frame?.id}
          frame={frame}
          embedded
          windowBars
          analysis={false}
          revision={shown?.version}
          selectionMode
          onPick={(x, y) => {
            const at = place({ x, y })
            moveCursor(at)
            if (reading && image?.click) pressKey(job, image.click, at)
          }}
          // The cursor stays where the pointer or arrow keys left it.
          onHover={(point) => point && moveCursor(place(point))}
          markers={markers}
          selectedMarker={pending ? String(used.length + 1) : undefined}
        />
      </div>
      <div ref={commandAnchor} className="cursor-command-anchor" />
      {reply && !commandOpen && (
        <output key={reply.id} className="cursor-status glass-surface">
          {reply.text}
        </output>
      )}
      {/* Up only while IRAF asks about its plot; it keeps its place and
          size for the next one. */}
      {plotted && !outside && (
        <GraphicsPip
          job={job}
          plotted={plotted}
          hidden={!asking || plotted === closed}
          onClose={() => setClosed(plotted)}
        />
      )}
    </div>
  )
}

/**
 * The task's plot as a window of its own, once taken out of the display
 * window's picture-in-picture; closing it puts the plot back there.
 */
export function GraphicsPanel() {
  const job = useCursorSession((state) => state.job)
  const plotted = useCursorSession((state) => state.plotted)
  // A window restored without its run has nothing to show; it closes once
  // the dock has finished restoring.
  useEffect(() => {
    if (job) return
    const timer = setTimeout(() => closePanel("graphics"))
    return () => clearTimeout(timer)
  }, [job])
  if (!job || !plotted) return <div className="viewer-window" />
  return (
    <div className="viewer-window">
      <WindowTitle title={job.manifest?.cursor?.graphics?.title ?? "IRAF 그래픽"} />
      <WindowToolbar>
        <GraphicsActions job={job} />
      </WindowToolbar>
      <div className="asset-content">
        <GraphicsPlot job={job} plotted={plotted} />
      </div>
    </div>
  )
}
