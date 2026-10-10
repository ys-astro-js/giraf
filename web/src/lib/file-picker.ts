import { jobTitle, taskDisplayName, type Frame, type Job } from "./workbench"

/** Highlighted rows of one list, the row a ⇧ range grows from, and the focused row. */
export type Highlight = {
  selected: string[]
  anchor: string | null
  focus: string | null
}
export const emptyHighlight: Highlight = {
  selected: [],
  anchor: null,
  focus: null,
}

function range(order: string[], from: string | null, to: string) {
  const a = from === null ? -1 : order.indexOf(from),
    b = order.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return order.slice(Math.min(a, b), Math.max(a, b) + 1)
}

/**
 * A click on a row: alone it highlights that row, ⇧ highlights the range
 * from the anchor, ⌘/Ctrl adds or removes the row (with ⇧, adds the range).
 */
export function clickHighlight(
  state: Highlight,
  order: string[],
  id: string,
  { shift = false, toggle = false }: { shift?: boolean; toggle?: boolean } = {}
): Highlight {
  if (shift) {
    const span = range(order, state.anchor ?? id, id)
    const selected = toggle ? [...new Set([...state.selected, ...span])] : span
    return { selected, anchor: state.anchor ?? id, focus: id }
  }
  if (toggle) {
    const selected = state.selected.includes(id)
      ? state.selected.filter((value) => value !== id)
      : [...state.selected, id]
    return { selected, anchor: id, focus: id }
  }
  return { selected: [id], anchor: id, focus: id }
}

/** Arrow keys: move the highlight by `step` rows; with ⇧, grow the range. */
export function moveHighlight(
  state: Highlight,
  order: string[],
  step: number,
  extend = false
): Highlight {
  if (!order.length) return state
  const at = state.focus === null ? -1 : order.indexOf(state.focus)
  const next =
    at < 0
      ? order[step < 0 ? order.length - 1 : 0]
      : order[Math.max(0, Math.min(order.length - 1, at + step))]
  if (extend) {
    const anchor = state.anchor ?? next
    return { selected: range(order, anchor, next), anchor, focus: next }
  }
  return { selected: [next], anchor: next, focus: next }
}

/** Drops highlighted ids that are no longer listed. */
export function keepListed(state: Highlight, order: string[]): Highlight {
  const listed = new Set(order)
  const selected = state.selected.filter((id) => listed.has(id))
  return selected.length === state.selected.length &&
    (state.focus === null || listed.has(state.focus))
    ? state
    : {
        selected,
        anchor: state.anchor && listed.has(state.anchor) ? state.anchor : null,
        focus: state.focus && listed.has(state.focus) ? state.focus : null,
      }
}

/** The rows a row action acts on: all highlighted rows when the row is one of them. */
export function actionTargets(state: Highlight, order: string[], id: string) {
  if (!state.selected.includes(id)) return [id]
  return order.filter((value) => state.selected.includes(value))
}

/** Adds files to an input in order, once each; a single input keeps one. */
export function addInputs(current: string[], ids: string[], multiple: boolean) {
  if (!ids.length) return current
  if (!multiple) return [ids[0]]
  return [...new Set([...current, ...ids])]
}

export function removeInputs(current: string[], ids: string[]) {
  const gone = new Set(ids)
  return current.filter((id) => !gone.has(id))
}

/** Moves the chosen items one place up (-1) or down (1) as a block. */
export function reorder(list: string[], chosen: string[], step: -1 | 1) {
  const picked = new Set(chosen),
    next = [...list]
  const indices = next.map((_, i) => i)
  if (step > 0) indices.reverse()
  for (const i of indices) {
    const j = i + step
    if (!picked.has(next[i]) || j < 0 || j >= next.length || picked.has(next[j]))
      continue
    ;[next[i], next[j]] = [next[j], next[i]]
  }
  return next
}

/** Back and forward through the places a picker visited. */
export type History = { entries: string[]; index: number }
export function visit(history: History, place: string): History {
  if (history.entries[history.index] === place) return history
  const entries = [...history.entries.slice(0, history.index + 1), place]
  return { entries, index: entries.length - 1 }
}
export function step(history: History, by: -1 | 1): History {
  const index = history.index + by
  return index < 0 || index >= history.entries.length
    ? history
    : { ...history, index }
}

/** A path's folders from the root, each with the path to go there. */
export function pathCrumbs(path: string) {
  const parts = path.split("/").filter(Boolean)
  const crumbs = [{ name: "/", path: "/" }]
  parts.forEach((name, i) =>
    crumbs.push({ name, path: "/" + parts.slice(0, i + 1).join("/") })
  )
  return path.startsWith("/") ? crumbs : crumbs.slice(1)
}

/** A run id's time, short: "10/01 13:45:57". */
export function runTime(id: string) {
  return /^\d{8}-\d{6}/.test(id)
    ? `${id.slice(4, 6)}/${id.slice(6, 8)} ${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}`
    : id
}

export type RunGroup = {
  id: string
  title: string
  task: string
  time: string
  files: Frame[]
}

/**
 * Run products grouped by run, newest first. Each node's latest run (all of
 * its rounds) stays on top; that node's earlier runs go to `older`.
 */
export function groupRuns(
  jobs: Job[],
  accept: (file: Frame) => boolean
): { recent: RunGroup[]; older: RunGroup[] } {
  const sorted = [...jobs].sort(
    (a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0) || b.id.localeCompare(a.id)
  )
  const latest = new Map<string, string>()
  const recent: RunGroup[] = [],
    older: RunGroup[] = []
  for (const job of sorted) {
    const files = job.products.filter(accept)
    if (!files.length) continue
    const node =
      job.manifest?.instanceId ||
      job.manifest?.nodeLabel ||
      job.task ||
      job.name
    // Rounds of one workflow run belong to the same run.
    const run = job.execution?.id || job.manifest?.workflowId || job.id
    if (!latest.has(node)) latest.set(node, run)
    const group = {
      id: job.id,
      title: jobTitle(job),
      task: taskDisplayName(job.task || job.manifest?.task || job.name),
      time: runTime(job.id),
      files,
    }
    ;(latest.get(node) === run ? recent : older).push(group)
  }
  return { recent, older }
}

/** The folder a file lives in, by name. */
export function folderName(path: string | undefined) {
  if (!path) return ""
  const parts = path.split("/").filter(Boolean)
  return parts.at(-2) ?? ""
}
