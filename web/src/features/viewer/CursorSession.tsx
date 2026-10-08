import { useEffect, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Keyboard, SquareTerminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { toast } from "@/components/ui/toast"
import { WindowTitle, WindowToolbar } from "@/features/dock/WindowToolbar"
import { ImageViewer } from "./ImageViewer"
import { ViewerPopover } from "./controls"
import { cursorRecord, respond, waitingCursor } from "@/lib/cursor-session"
import { type Job } from "@/lib/workbench"
import { displayQueryOptions, displayRow, frameToImage } from "@/lib/display"

type Point = { x: number; y: number }

/**
 * A running task's cursor loop in the IRAF display window, like typing into
 * ds9 or a graphics terminal: the image cursor reads the key pressed over a
 * star, the graphics cursor the key pressed over the task's plot. The keys
 * come from the task's own IRAF key help; its output stays in the run log.
 */
export function CursorSession({ job }: { job: Job }) {
  const interaction = waitingCursor(job)!
  const graphics = interaction.kind === "gcur"
  const manifest = job.manifest!
  // The image cursor reads the display, as in IRAF: the frame the user
  // displayed, in its image's coordinates. Without one, the task's image.
  const { data: display } = useQuery(displayQueryOptions)
  const shown =
    display?.frames.find((f) => f.frame === display.current) ??
    display?.frames[0]
  const frame = shown
    ? displayRow(shown)
    : manifest.rows.find((row) => row.id === manifest.cursorImage)
  const toImage = (p: Point) => (shown ? frameToImage(shown, p.x, p.y) : p)
  const group = manifest.cursorKeys?.find(
    (g) => g.cursor === (graphics ? "graphics" : "image")
  )
  const rootRef = useRef<HTMLDivElement>(null)
  const hover = useRef<Point | null>(null)
  const [mark, setMark] = useState<Point>()
  const [colonOpen, setColonOpen] = useState(false)
  const [command, setCommand] = useState("")
  // One answer per request; the next request arrives with a new id.
  const [sent, setSent] = useState("")
  const busy = sent === interaction.id

  // Keys go where IRAF reads them, as in its own cursor windows: focus
  // follows each request unless the user is busy elsewhere.
  useEffect(() => {
    const active = document.activeElement
    if (!active || active === document.body) rootRef.current?.focus()
  }, [interaction.id])

  function press(key: string, colon = "") {
    if (busy) return
    // The graphics cursor's plot coordinates are not mapped yet.
    const at = graphics ? undefined : (hover.current ?? mark)
    if (at) setMark(at)
    setSent(interaction.id)
    respond(
      job,
      cursorRecord(key, at && (toImage(at) ?? undefined), colon)
    ).catch((error: Error) => {
      setSent("")
      toast.add({ title: error.message, type: "error" })
    })
  }

  return (
    <div
      ref={rootRef}
      tabIndex={-1}
      className="viewer-window outline-none"
      aria-busy={busy}
      onPointerEnter={() => {
        const active = document.activeElement
        if (!active?.closest("input, textarea, [role=menu], [role=dialog]"))
          rootRef.current?.focus({ preventScroll: true })
      }}
      onKeyDown={(e) => {
        const target = e.target as HTMLElement
        if (target.closest("input, textarea, [role=menu]")) return
        if (e.metaKey || e.ctrlKey || e.altKey) return
        if (e.key.length !== 1 || e.key === " ") return
        e.preventDefault()
        // Colon commands take arguments, as in IRAF's cursor mode.
        if (e.key === ":") setColonOpen(true)
        else press(e.key)
      }}
    >
      <WindowTitle
        title={graphics ? "IRAF 그래픽" : frame?.label}
        subtitle={
          busy
            ? `${job.name} · IRAF 처리 중`
            : `${job.name} · ${graphics ? "그래픽" : "영상"} 커서 입력 대기`
        }
        tooltip={frame?.label}
      />
      <WindowToolbar>
        <ToolbarGroup label="IRAF 커서">
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<ToolbarButton label="커서 키" />}
              disabled={!group?.keys.length}
            >
              <Keyboard />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-h-(--available-height)"
            >
              <DropdownMenuGroup>
                {group?.keys.map((k) => (
                  <DropdownMenuItem
                    key={k.key}
                    disabled={busy}
                    onClick={() => press(k.key)}
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
          <ViewerPopover
            label="콜론 명령"
            icon={SquareTerminal}
            open={colonOpen}
            onOpenChange={setColonOpen}
          >
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault()
                const text = command.trim().replace(/^:/, "")
                if (!text) return
                press(":", text)
                setCommand("")
                setColonOpen(false)
                rootRef.current?.focus()
              }}
            >
              <Field>
                <FieldLabel htmlFor={`colon-${job.id}`}>명령</FieldLabel>
                <Input
                  id={`colon-${job.id}`}
                  list={`colon-${job.id}-list`}
                  value={command}
                  placeholder={group?.colon[0]?.command}
                  spellCheck={false}
                  autoComplete="off"
                  className="font-mono"
                  onChange={(e) => setCommand(e.target.value)}
                />
                <datalist id={`colon-${job.id}-list`}>
                  {group?.colon.map((c) => (
                    <option key={c.command} value={c.command}>
                      {c.description}
                    </option>
                  ))}
                </datalist>
                <FieldDescription>
                  키보드에서 <kbd>:</kbd>를 눌러도 열립니다.
                </FieldDescription>
              </Field>
              <Button
                className="self-end"
                variant="outline"
                size="sm"
                type="submit"
                disabled={busy}
              >
                보내기
              </Button>
            </form>
          </ViewerPopover>
        </ToolbarGroup>
      </WindowToolbar>
      {graphics ? (
        // The display window runs content under its bars; a plot sits between.
        <div
          className="asset-content"
          style={{
            paddingTop: "var(--window-header)",
            paddingBottom: "var(--window-footer)",
          }}
        >
          <img
            className="asset-plot"
            src={`/api/task-graphics?id=${encodeURIComponent(job.id)}&request=${interaction.id}`}
            alt={`${job.name} 그래픽`}
          />
        </div>
      ) : (
        <div className="viewer-grid">
          <ImageViewer
            key={frame?.id}
            frame={frame}
            embedded
            windowBars
            analysis={false}
            revision={shown?.version}
            selectionMode
            onPick={(x, y) => setMark({ x, y })}
            onHover={(point) => (hover.current = point)}
            markers={mark ? [{ ...mark, label: "" }] : []}
          />
        </div>
      )}
    </div>
  )
}
