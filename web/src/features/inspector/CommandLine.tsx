/**
 * One CL line of the 명령 section, edited in place: Enter or leaving the
 * line reads it with the node's task (POST /api/parse-commands) and sets
 * what changed (lib/command-edit). Esc puts the line back.
 */
import { useEffect, useRef, useState } from "react"
import { applyCommandEdit } from "@/lib/command-edit"
import type { ParsedCommands } from "@/lib/command-workflow"
import type { Instance } from "@/lib/task-map"
import { api, type Catalog, type Spec } from "@/lib/workbench"

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ").replace(/\\\s*$/, "").trim()

export function CommandLine({ line, task, spec, catalog, group, edit }: {
  line: string
  task: Instance
  spec: Spec
  catalog: Catalog
  /** The group this line runs, of a split task's groups. */
  group?: { id: string; groups: string[] }
  edit: (fn: (task: Instance) => Instance) => void
}) {
  const [draft, setDraft] = useState(line)
  const committing = useRef(false)
  const cancelled = useRef(false)
  useEffect(() => setDraft(line), [line])
  async function commit() {
    const edited = oneLine(draft)
    if (cancelled.current || committing.current || edited === line) {
      cancelled.current = false
      return setDraft(line)
    }
    committing.current = true
    try {
      const parsed = await api<ParsedCommands>("parse-commands", { text: `${line}\n${edited}`, task: spec.name, resolve: false })
      const [before, after] = parsed.lines
      if (before && after) edit((current) => applyCommandEdit(current, spec, catalog, before, after, group))
    } catch {
      setDraft(line)
    } finally {
      committing.current = false
    }
  }
  return (
    <textarea
      className="font-mono command-line command-edit"
      aria-label={`${task.label} 명령`}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      rows={1}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === "Enter") {
          event.preventDefault()
          event.currentTarget.blur()
        } else if (event.key === "Escape") {
          event.preventDefault()
          event.stopPropagation()
          cancelled.current = true
          event.currentTarget.blur()
        }
      }}
    />
  )
}
