import { useSyncExternalStore } from "react"

// The desktop app's own update (desktop/main.cjs): it checks the latest
// release at launch and downloads it in the background. Only the desktop app
// has the bridge; in a browser there is nothing to update.

export type UpdateState = {
  state: "idle" | "checking" | "not-available" | "downloading" | "downloaded" | "error"
  /** The running version. */
  current: string
  /** The new version, while downloading or downloaded. */
  version?: string
  /** Its release notes (RELEASE_NOTES.md), as markdown. */
  notes?: string
  percent?: number
}

export type UpdateBridge = {
  get: () => Promise<UpdateState>
  check: () => Promise<UpdateState>
  install: () => void
  onState: (callback: (state: UpdateState) => void) => () => void
}

let snapshot: UpdateState | undefined
const listeners = new Set<() => void>()
let started = false

function publish(state: UpdateState) {
  snapshot = state
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  const bridge = window.girafShell?.update
  if (bridge && !started) {
    started = true
    bridge.onState(publish)
    // A state pushed meanwhile is newer than the one asked for.
    void bridge.get().then((state) => snapshot || publish(state))
  }
  return () => listeners.delete(listener)
}

/** The update state, or undefined outside the desktop app. */
export function useAppUpdate() {
  return useSyncExternalStore(subscribe, () => snapshot, () => undefined)
}

export function checkForUpdate() {
  void window.girafShell?.update?.check()
}

export function installUpdate() {
  window.girafShell?.update?.install()
}

export type NotesSection = { title?: string; items: string[] }

/**
 * Release notes in RELEASE_NOTES.md's shape: `## ` headings over `- ` items.
 * A line that is neither continues the item before it.
 */
export function parseReleaseNotes(markdown: string): NotesSection[] {
  const sections: NotesSection[] = []
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    if (heading) {
      sections.push({ title: heading[1], items: [] })
      continue
    }
    const item = /^[-*+]\s+(.*)$/.exec(line)
    if (!sections.length) sections.push({ items: [] })
    const items = sections[sections.length - 1].items
    if (item || !items.length) items.push(item ? item[1] : line)
    else items[items.length - 1] += ` ${line}`
  }
  return sections.filter((section) => section.items.length)
}

/** Splits `inline code` out of a note item. */
export function inlineCode(text: string) {
  return text
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((part) =>
      part.length > 2 && part.startsWith("`") && part.endsWith("`")
        ? { code: true, text: part.slice(1, -1) }
        : { code: false, text: part }
    )
}
