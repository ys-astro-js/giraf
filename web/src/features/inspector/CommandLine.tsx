/**
 * One CL line of the 명령 section, edited in place: Enter or leaving the
 * line reads it with the node's task (POST /api/parse-commands) and sets
 * what changed (lib/command-edit). Esc puts the line back. Not being edited,
 * the token of a field with a problem is marked in place, its message the
 * node's diagnostic for that field (diagnostics fieldIssues).
 */
import { Fragment, useEffect, useRef, useState } from "react"
import { applyCommandEdit } from "@/lib/command-edit"
import type { ParsedCommands } from "@/lib/command-workflow"
import type { Instance } from "@/lib/task-map"
import { api, type Catalog, type Spec } from "@/lib/workbench"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

/** A problem of one token of a line: its span and the diagnostic's message. */
export type CommandIssue = { name: string; start: number; end: number; severity: "error" | "warning"; message: string }

const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ").replace(/\\\s*$/, "").trim()

/** The line as text runs, each marked run carrying the problems of its token. */
export function markedRuns(line: string, issues: CommandIssue[]) {
  const runs: { text: string; issues: CommandIssue[] }[] = []
  const spans = [...issues].filter((i) => i.start < i.end && i.end <= line.length).sort((a, b) => a.start - b.start)
  let at = 0
  for (const span of spans) {
    if (span.start < at) {
      // The same token again: one mark with every problem it has.
      const last = runs[runs.length - 1]
      if (last?.issues.length && span.start >= at - last.text.length) last.issues.push(span)
      continue
    }
    if (span.start > at) runs.push({ text: line.slice(at, span.start), issues: [] })
    runs.push({ text: line.slice(span.start, span.end), issues: [span] })
    at = span.end
  }
  if (at < line.length) runs.push({ text: line.slice(at), issues: [] })
  return runs
}

/** The line with each token that has a problem marked, its messages shown on hover. */
export function MarkedText({ line, issues }: { line: string; issues: CommandIssue[] }) {
  return markedRuns(line, issues).map((run, i) =>
    run.issues.length ? (
      <Tooltip key={i}>
        <TooltipTrigger render={<mark className="command-issue" data-severity={run.issues.some((p) => p.severity === "error") ? "error" : "warning"} />}>
          {run.text}
        </TooltipTrigger>
        <TooltipContent className="flex-col items-start whitespace-pre-line">{run.issues.map((p) => p.message).join("\n")}</TooltipContent>
      </Tooltip>
    ) : <Fragment key={i}>{run.text}</Fragment>
  )
}

export function CommandLine({ line, issues = [], task, spec, catalog, group, edit }: {
  line: string
  issues?: CommandIssue[]
  task: Instance
  spec: Spec
  catalog: Catalog
  /** The group this line runs, of a split task's groups. */
  group?: { id: string; groups: string[] }
  edit: (fn: (task: Instance) => Instance) => void
}) {
  const [draft, setDraft] = useState(line)
  const [editing, setEditing] = useState(false)
  const committing = useRef(false)
  const cancelled = useRef(false)
  useEffect(() => setDraft(line), [line])
  async function commit() {
    setEditing(false)
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
  if (!editing && issues.length && draft === line)
    return (
      <div className="font-mono command-line command-edit command-marked" role="textbox" tabIndex={0}
        aria-label={`${task.label} 명령`} aria-readonly={false}
        onFocus={() => setEditing(true)}>
        <MarkedText line={line} issues={issues} />
      </div>
    )
  return (
    <textarea
      className="font-mono command-line command-edit"
      aria-label={`${task.label} 명령`}
      spellCheck={false}
      autoCapitalize="off"
      autoCorrect="off"
      autoFocus={editing}
      rows={1}
      value={draft}
      onFocus={() => setEditing(true)}
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
