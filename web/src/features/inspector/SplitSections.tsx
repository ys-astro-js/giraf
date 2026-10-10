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

type CommandGroup = { id: string; name: string; files: string[]; commands?: string[]; problem?: string }

/** 명령: the CL line each group runs. */
export function CommandsSection({ map, catalog, task }: Omit<Props, "rows">) {
  const folder = useContext(WorkbenchContext)?.workspace.folder ?? ""
  const request = commandsRequest(map, catalog, task.id, folder)
  const key = JSON.stringify(request ?? null)
  const { data } = useQuery({
    queryKey: ["api", "task-commands", key],
    queryFn: ({ signal }) => api<{ groups: CommandGroup[]; problem?: string }>("task-commands", JSON.parse(key), signal),
    enabled: !!request,
    placeholderData: keepPreviousData,
    retry: false,
  })
  const lines = (data?.groups ?? []).flatMap((g) => g.commands?.map((line) => ({ key: `${g.id}:${line}`, line })) ?? [])
  const problems = [...new Set([data?.problem, ...(data?.groups ?? []).map((g) => g.problem && (g.name ? `${g.name}: ${g.problem}` : g.problem))].filter(Boolean))] as string[]
  if (!lines.length && !problems.length) return null
  return (
    <section className="inspector-section" aria-label="명령">
      <h3>명령</h3>
      <ul className="input-files pass-files commands" aria-label="명령">
        {lines.map(({ key, line }) => <li key={key}><span className="font-mono command-line">{line}</span></li>)}
        {problems.map((message) => <li key={message}><span className="pass-value" data-missing="">{message}</span></li>)}
      </ul>
    </section>
  )
}
