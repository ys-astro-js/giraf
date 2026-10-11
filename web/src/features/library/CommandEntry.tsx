/**
 * The add popover's 명령 body: IRAF CL commands in, nodes out. The server
 * reads the text (giraf/command_parse.py); lib/command-workflow builds the
 * nodes and the connections the preview shows before anything is added.
 */
import { Fragment, useEffect, useMemo, useState, type RefObject } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { Check, CircleAlert, CircleCheck, CircleMinus, File, Rows3 } from "lucide-react"
import { ToolbarButton, ToolbarCluster, ToolbarGroup } from "@/components/toolbar"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import {
  buildCommandNodes,
  commandRuns,
  placeCommandNodes,
  type CommandRun,
  type ParsedCommands,
  type ParsedLine,
} from "@/lib/command-workflow"
import { api } from "@/lib/workbench"
import { useWorkbench } from "@/features/workbench/context"

const imageStem = (name: string) => name.replace(/\.(fits?|fts|imh)$/i, "")

type Status = "added" | "skipped" | "issue"

/** What one line becomes, as a row: the task, what it sets, what it reads. */
function LineRow({ line, issues, inactive = [] }: { line: ParsedLine; issues: string[]; inactive?: string[] }) {
  const status: Status = issues.length ? "issue" : line.kind === "skip" ? "skipped" : "added"
  const Icon = { added: CircleCheck, skipped: CircleMinus, issue: CircleAlert }[status]
  let name = line.text.split(/\s+/)[0]
  let detail: React.ReactNode = null
  if (line.kind === "task") {
    name = line.taskName ?? name
    const sets = [
      ...Object.entries(line.parameters ?? {}),
      ...Object.values(line.parameterSets ?? {}).flatMap((values) => Object.entries(values)),
      ...Object.entries(line.preprocess ?? {}),
      ...Object.entries(line.packageValues ?? {}),
    ].map(([key, value]) => `${key}=${value === "" ? '""' : value}`)
    const outputs = Object.values(line.outputs ?? {}).flatMap((o) => o.labels.map(imageStem))
    const inputs = Object.entries(line.inputs ?? {}).filter(([role]) => !inactive.includes(role)).map(([, input]) => input)
    const from = [...new Set(inputs.flatMap((input) =>
      input.items.flatMap((item) => (item.from ? [imageStem(item.from.label)] : []))))]
    const files = inputs.flatMap((input) => input.items.filter((item) => item.file)).length
    detail = (
      <>
        {(!!from.length || !!files) && (
          <span className="command-links">
            ←{from.length > 0 && ` ${from.join(", ")}`}
            {files > 0 && <span className="command-files"><File aria-label="파일" />{files}</span>}
          </span>
        )}
        {!!outputs.length && <span>→ {outputs.join(", ")}</span>}
        {!!sets.length && <span>{sets.join(" ")}</span>}
      </>
    )
  } else if (line.kind === "list") {
    name = line.list ?? name
    detail = <span className="command-files"><File aria-label="파일" />{line.files?.length ?? 0}</span>
  } else if (line.kind === "assign") {
    name = `${line.target}.${line.parameter}`
    detail = <span>{line.value === "" ? '""' : line.value} → {line.applied?.length ?? 0}줄</span>
  } else if (line.kind === "skip") {
    detail = <span>{line.reason}</span>
  }
  return (
    <li className="command-row" data-status={status}>
      <Icon aria-label={{ added: "추가", skipped: "건너뜀", issue: "문제" }[status]} />
      <div className="library-option-text">
        <span className="library-option-name">{name}</span>
        <span className="font-mono command-text">{line.text}</span>
        {detail && <span className="library-option-detail command-detail">{detail}</span>}
        {issues.map((issue) => <span key={issue} className="library-option-detail command-issue">{issue}</span>)}
      </div>
    </li>
  )
}

/** The explicit choice to make a run of lines one split node. */
function MergeRow({ run, merged, onChange }: { run: CommandRun; merged: boolean; onChange: (merged: boolean) => void }) {
  return (
    <li className="command-row command-merge">
      <label className="flex items-center gap-2">
        <Checkbox checked={merged} disabled={!!run.disabled} onCheckedChange={(checked) => onChange(!!checked)} />
        <span className="library-option-name">노드 하나로 합치기</span>
      </label>
      <span className="library-option-detail">
        {run.disabled ?? <span className="command-files"><Rows3 aria-label="명령" />{run.lines.length}</span>}
      </span>
    </li>
  )
}

export function CommandEntry({ inputRef, onDone }: { inputRef: RefObject<HTMLTextAreaElement | null>; onDone: () => void }) {
  const w = useWorkbench()
  const [text, setText] = useState("")
  const [merged, setMerged] = useState<ReadonlySet<number>>(new Set())
  const [adding, setAdding] = useState(false)
  // Read the text once typing pauses.
  const [deferred, setDeferred] = useState("")
  useEffect(() => {
    const timer = setTimeout(() => setDeferred(text), 250)
    return () => clearTimeout(timer)
  }, [text])
  const { data, error } = useQuery({
    queryKey: ["api", "parse-commands", deferred, w.workspace.folder],
    queryFn: ({ signal }) => api<ParsedCommands>("parse-commands", { text: deferred }, signal),
    enabled: !!deferred.trim(),
    placeholderData: keepPreviousData,
    retry: false,
  })
  // A failed read goes to 경고 및 오류 (api); the entry shows nothing stale to add.
  const parsed = deferred.trim() && !error ? data : undefined
  const folder = w.workspace.files
  const runs = useMemo(() => (parsed ? commandRuns(parsed, folder, merged) : []), [parsed, folder, merged])
  const built = useMemo(
    () => (parsed && w.catalog ? buildCommandNodes(w.map, w.catalog, w.prefs, w.rows, parsed, merged) : undefined),
    [parsed, w.map, w.catalog, w.prefs, w.rows, merged]
  )
  const shown = parsed?.lines.filter((line) => line.kind !== "package") ?? []
  const count = built?.added.length ?? 0
  async function add() {
    if (!built || !w.catalog || !count || adding) return
    setAdding(true)
    try {
      const before = w.map
      const placed = await placeCommandNodes(before, built.map, w.catalog, w.rows)
      const selected = built.added.at(-1)!
      w.update((current) => (current.tasks === before.tasks && current.connections === before.connections
        ? { ...placed, view: { ...placed.view, selected } }
        : current), "명령으로 노드 추가")
      setText("")
      setMerged(new Set())
      onDone()
    } finally {
      setAdding(false)
    }
  }
  return (
    <div className="command-entry">
      <Textarea
        ref={inputRef}
        autoFocus
        aria-label="IRAF 명령"
        className="font-mono command-input"
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="zerocombine @bias.list output=Zero"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
            event.preventDefault()
            void add()
          }
        }}
      />
      {shown.length > 0 && (
        <ul className="command-preview scroll-fade scroll-fade-4" aria-label="명령 미리보기">
          {shown.map((line) => {
            const run = runs.find((r) => r.lines[0] === line.index)
            return (
              <Fragment key={line.index}>
                {run && (
                  <MergeRow
                    run={run}
                    merged={merged.has(line.index)}
                    onChange={(on) => setMerged((previous) => {
                      const next = new Set(previous)
                      if (on) next.add(line.index)
                      else next.delete(line.index)
                      return next
                    })}
                  />
                )}
                <LineRow line={line} inactive={built?.inactive[line.index]} issues={[...line.issues, ...(built?.issues[line.index] ?? [])]} />
              </Fragment>
            )
          })}
        </ul>
      )}
      <div className="command-actions">
        {count > 0 && (
          <span className="text-sm text-muted-foreground" role="status" aria-label={`노드 ${count}`}>
            {count}
          </span>
        )}
        <ToolbarCluster edge="end">
          <ToolbarGroup label="추가">
            <ToolbarButton prominent label="추가" disabled={!count || adding} onClick={add}>
              <Check />
            </ToolbarButton>
          </ToolbarGroup>
        </ToolbarCluster>
      </div>
    </div>
  )
}
