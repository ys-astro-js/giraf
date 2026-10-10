import { create } from "zustand"
import { toast } from "@/components/ui/toast"
import { api, type Job } from "./workbench"

/** A cursor key with a name for people who do not know it (node schema). */
export type CursorIcon =
  | "check"
  | "trash"
  | "sigma"
  | "save"
  | "plus"
  | "minus"
  | "refresh"
  | "list"
  | "eye"
  | "x"
export type CursorAction = { key: string; label: string; icon?: CursorIcon }
/** The node schema's `cursor` component (giraf/node_schema.py). */
export type CursorComponent = {
  image?: {
    click?: string
    count?: string
    actions?: CursorAction[]
    finish?: { label: string; icon?: CursorIcon; keys: string[] }
  }
  graphics?: {
    title?: string
    accept?: CursorAction
    reject?: CursorAction
  }
}
export type Point = { x: number; y: number }
/** Where the image cursor is: in the window (for marks) and in the task's image. */
export type Place = { view: Point; image?: Point }

/**
 * IRAF cursor reads a running task waits for (text cursor mode). Its
 * single-key questions are ordinary prompts for the input dialog.
 */
export const CURSOR_KINDS = ["imcur", "gcur"] as const

export function waitingCursor(job: Job | undefined) {
  const interaction = job?.interaction
  return job?.state === "waiting" &&
    interaction?.state === "waiting" &&
    job.manifest?.interactive &&
    (CURSOR_KINDS as readonly string[]).includes(interaction.kind)
    ? interaction
    : undefined
}

/** A run whose cursor loop the display and graphics windows host. */
export const interactiveRun = (job: Job | undefined) =>
  !!job?.manifest?.interactive &&
  ["queued", "running", "waiting"].includes(job.state)

/** One cursor record: `x y wcs key [command]`, as IRAF's text cursor mode reads it. */
export function cursorRecord(key: string, at?: Point, command = "") {
  const { x, y } = at ?? { x: 0, y: 0 }
  return `${x} ${y} 1 ${key}${command ? " " + command : ""}`
}

type Session = {
  job: Job | null
  /** Marks the task accepted, and the one it is asking about (view coordinates). */
  used: Point[]
  pending: Point | null
  /** The request answered last: no second answer until the next one. */
  answered: string
  /** Answers still to send, one per request (a `finish` sequence). */
  queue: string[]
  /** The last graphics cursor request: its plot stays up until the run ends. */
  plotted: string
  /** The image cursor: where the pointer or arrow keys left it, as in IRAF. */
  at: Place | null
  /** The colon command field is open (the toolbar button or `:`). */
  command: boolean
}

export const useCursorSession = create<Session>(() => ({
  job: null,
  used: [],
  pending: null,
  answered: "",
  queue: [],
  plotted: "",
  at: null,
  command: false,
}))

const session = () => useCursorSession.getState()
const set = (state: Partial<Session>) => useCursorSession.setState(state)

/** Answers the run's current request; `key` questions take the bare key. */
function answer(job: Job, value: string) {
  const id = job.interaction!.id
  set({ answered: id })
  api("task-respond", { id: job.id, requestId: id, value }).catch(
    (error: Error) => {
      set({ answered: "", queue: [] })
      toast.add({ title: error.message, type: "error" })
    }
  )
}

/**
 * Sends a key to the waiting cursor. `view` is where it was pressed in the
 * window (for marks), `image` the same place in the task's image.
 */
export function pressKey(
  job: Job,
  key: string,
  place: Place | null = session().at,
  command = ""
) {
  const interaction = waitingCursor(job)
  if (!interaction || session().answered === interaction.id) return
  const cursor = job.manifest?.cursor
  if (interaction.kind === "imcur") {
    if (key === cursor?.image?.click && place) set({ pending: place.view })
    answer(job, cursorRecord(key, place?.image, command))
    return
  }
  const { pending, used } = session()
  if (key === cursor?.graphics?.accept?.key && pending)
    set({ used: [...used, pending], pending: null })
  else if (key === cursor?.graphics?.reject?.key) set({ pending: null })
  // The graphics cursor's plot coordinates are not mapped yet.
  answer(job, cursorRecord(key, undefined, command))
}

/** Starts a sequence of answers, e.g. write the result, then quit. */
export function finish(job: Job, keys: string[]) {
  set({ queue: keys })
  advance(job)
}

/** Follows the run's requests: drops stale marks, continues a sequence. */
export function advance(job: Job) {
  const interaction = job.interaction
  if (!interaction || interaction.state !== "waiting") return
  const { queue, answered, pending, used } = session()
  if (answered === interaction.id) return
  // Back at the image: a task that never asks about the star (no graphics
  // accept, daoedit) has taken it; one that does has dropped it.
  if (interaction.kind === "imcur" && pending)
    set(
      job.manifest?.cursor?.graphics?.accept
        ? { pending: null }
        : { used: [...used, pending], pending: null }
    )
  if (!queue.length) return
  const [key, ...rest] = queue
  set({ queue: rest })
  answer(job, interaction.kind === "key" ? key : cursorRecord(key))
}

export function startSession(job: Job | null) {
  const plot =
    job?.interaction?.state === "waiting" && job.interaction.kind === "gcur"
      ? { plotted: job.interaction.id }
      : {}
  if (session().job?.id === job?.id) set({ job, ...plot })
  else
    set({
      job,
      used: [],
      pending: null,
      answered: "",
      queue: [],
      plotted: "",
      at: null,
      command: false,
      ...plot,
    })
}

export const moveCursor = (at: Place) => set({ at })
export const openCommand = (command: boolean) => set({ command })

/**
 * While a run reads the cursor, keys typed anywhere outside a field, menu or
 * dialog go to IRAF, as its cursor windows take them: at the image cursor
 * for imcur, as is for gcur. `:` opens the colon command field instead.
 */
/** US-layout characters of the punctuation keys, unshifted and shifted. */
const PUNCTUATION: Record<string, [string, string]> = {
  Semicolon: [";", ":"],
  Quote: ["'", '"'],
  Comma: [",", "<"],
  Period: [".", ">"],
  Slash: ["/", "?"],
  Minus: ["-", "_"],
  Equal: ["=", "+"],
  BracketLeft: ["[", "{"],
  BracketRight: ["]", "}"],
  Backslash: ["\\", "|"],
  Backquote: ["`", "~"],
}
const SHIFTED_DIGITS = ")!@#$%^&*("

/**
 * The IRAF key a keystroke means. IRAF keys are ASCII, so with another
 * input source on (a Korean IME gives "ㅁ" or "Process" for `a`) the
 * physical key decides, as on a US keyboard.
 */
export function irafKey(e: KeyboardEvent) {
  if (e.key.length === 1 && e.key !== " " && e.key.charCodeAt(0) < 128)
    return e.key
  const letter = /^Key([A-Z])$/.exec(e.code)?.[1]
  if (letter) return e.shiftKey ? letter : letter.toLowerCase()
  const digit = /^Digit(\d)$/.exec(e.code)?.[1]
  if (digit) return e.shiftKey ? SHIFTED_DIGITS[+digit] : digit
  const punctuation = PUNCTUATION[e.code]
  return punctuation ? punctuation[e.shiftKey ? 1 : 0] : null
}

export function cursorKeydown(e: KeyboardEvent) {
  const job = session().job
  if (!job) return
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
  const key = irafKey(e)
  if (!key) return
  const target = e.target as HTMLElement | null
  if (
    target?.closest(
      "input, textarea, select, [contenteditable], [role=menu], [role=dialog], [role=listbox]"
    )
  )
    return
  // Taken even while IRAF is busy, so a letter never falls through to
  // the app's own shortcuts mid-session.
  e.preventDefault()
  if (!waitingCursor(job)) return
  if (key === ":") openCommand(true)
  else pressKey(job, key)
}
