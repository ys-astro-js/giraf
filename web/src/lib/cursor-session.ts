import { create } from "zustand"
import { api, type Job } from "./workbench"

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

/** The run whose cursor loop the display window currently hosts. */
export const useCursorSession = create<{ job: Job | null }>(() => ({
  job: null,
}))

/** One cursor record: `x y wcs key [command]`, as IRAF's text cursor mode reads it. */
export function cursorRecord(
  key: string,
  position?: { x: number; y: number },
  command = ""
) {
  const { x, y } = position ?? { x: 0, y: 0 }
  return `${x} ${y} 1 ${key}${command ? " " + command : ""}`
}

export function respond(job: Job, value: string) {
  return api("task-respond", {
    id: job.id,
    requestId: job.interaction!.id,
    value,
  })
}
