/**
 * A split task's inspector sections (lib/splits): its parameters in each
 * group as a table under the group chips, and the CL command each group
 * runs, built by the server the way a run builds it (giraf/server.py
 * task_commands).
 */
import { useContext } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { TokenIcon } from "@/components/split-token"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { WorkbenchContext } from "@/features/workbench/context"
import { useValueResults } from "@/features/workflow/useValueResults"
import { groupedValue } from "@/lib/group-values"
import { taskGroups } from "@/lib/splits"
import { commandsRequest, type Instance, type TaskMap } from "@/lib/task-map"
import { pinnedKeys } from "@/lib/values"
import { CommandLine, MarkedText, type CommandIssue } from "./CommandLine"
import type { FieldIssue } from "@/lib/diagnostics"
import { useFieldIssues } from "@/lib/field-issues"
import { api, type Catalog, type Frame } from "@/lib/workbench"

type Props = { map: TaskMap; catalog: Catalog; task: Instance; rows: Frame[] }

/** 값: each shown parameter in each group; one value for all spans the groups. */
export function GroupValuesSection({ map, catalog, task, rows }: Props) {
  const { results } = useValueResults(map, catalog, rows)
  const groups = taskGroups(map, task, rows).groups ?? []
  const keys = pinnedKeys(map, catalog, task)
  if (groups.length < 2 || !keys.length) return null
  return (
    <section className="inspector-section" aria-label="값">
      <Table aria-label="값" className="group-values">
        <TableHeader>
          <TableRow>
            <TableHead><span className="sr-only">이름</span></TableHead>
            {groups.map((g) => (
              <TableHead key={g.id} className="group-values-head"><span className="partition-chip" data-filter={g.name}>{g.name}</span></TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.map((key) => {
            const value = groupedValue(map, catalog, task, key, groups, results)
            const name = key.slice(key.lastIndexOf(".") + 1)
            return (
              <TableRow key={key}>
                <TableHead scope="row" className="group-values-name">
                  <span className="font-mono">{name}</span>
                  {value.formula && <span className="group-values-note font-mono">{value.formula}</span>}
                  {value.kind && <TokenIcon icon={value.kind} />}
                </TableHead>
                {value.cells
                  ? value.cells.map((cell, i) => <TableCell key={groups[i].id} className="group-values-cell">{cell}</TableCell>)
                  : <TableCell colSpan={groups.length} className="group-values-cell">{value.text}</TableCell>}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}

/** The span of one value in a line, named by the field it sets (giraf/commands.py). */
export type CommandToken = { name: string; start: number; end: number }
/** A group's lines (giraf/server.py task_commands), each with its values' spans. */
export type CommandGroup = { id: string; name: string; files: string[]; lines?: { text: string; tokens: CommandToken[] }[] }

/** The problems of a line: each field's problem on the token that sets it. */
export function tokenIssues(tokens: CommandToken[], issues: Map<string, FieldIssue>): CommandIssue[] {
  return tokens.flatMap((token) => {
    const issue = issues.get(token.name)
    return issue ? [{ ...token, ...issue }] : []
  })
}

/** 명령: the CL line each group runs, each editable in place (CommandLine). */
export function CommandsSection({ map, catalog, task }: Omit<Props, "rows">) {
  const workbench = useContext(WorkbenchContext)
  const folder = workbench?.workspace.folder ?? ""
  const request = commandsRequest(map, catalog, task.id, folder)
  const key = JSON.stringify(request ?? null)
  const { data } = useQuery({
    queryKey: ["api", "task-commands", key],
    queryFn: ({ signal }) => api<{ groups: CommandGroup[] }>("task-commands", JSON.parse(key), signal),
    enabled: !!request,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const issues = useFieldIssues(task.id)
  return <CommandList groups={data?.groups ?? []} catalog={catalog} task={task} issues={issues} />
}

/**
 * The lines as built, a token with a problem marked in place. The messages
 * are listed by the node's diagnostics alone; with no line, no section.
 */
export function CommandList({ groups, catalog, task, issues }: {
  groups: CommandGroup[]
  catalog: Catalog
  task: Instance
  /** The node's problems by field (diagnostics fieldIssues). */
  issues: Map<string, FieldIssue>
}) {
  const workbench = useContext(WorkbenchContext)
  const spec = catalog.tasks.find((s) => s.name === task.task)
  const ids = groups.map((g) => g.id)
  const lines = groups.flatMap((g) => (g.lines ?? []).map((line, i) => ({ key: `${g.id}:${i}`, line, group: g.id })))
  if (!lines.length) return null
  return (
    <section className="inspector-section" aria-label="명령">
      <h3>명령</h3>
      <ul className="input-files pass-files commands" aria-label="명령">
        {lines.map(({ key, line, group }) => (
          <li key={key}>
            {workbench && spec ? (
              <CommandLine line={line.text} issues={tokenIssues(line.tokens, issues)} task={task} spec={spec} catalog={catalog}
                group={ids.length > 1 ? { id: group, groups: ids } : undefined}
                edit={(fn) => workbench.edit(fn, task.id)} />
            ) : <span className="font-mono command-line"><MarkedText line={line.text} issues={tokenIssues(line.tokens, issues)} /></span>}
          </li>
        ))}
      </ul>
    </section>
  )
}
