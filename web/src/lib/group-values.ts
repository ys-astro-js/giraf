/**
 * A split task's parameter in each of its groups (lib/splits), as the node
 * and the inspector show it: a value set per group (`groupValues`), a formula
 * of the task's other parameters (`formulas`), or a value connection the
 * server resolves once per group (giraf/values.py ValueGraph.parameters).
 * Anything else is one value for every group.
 */
import type { Instance, TaskMap } from "./task-map/model"
import type { Catalog } from "./workbench"
import { formulaValue, type SplitGroup } from "./splits"
import { formatScalar, formatValue, parameterEntries, psetSource, storedValue, PARAM_HANDLE, VALUE_HANDLE, type ValueResponse } from "./values"

/** Where a value comes from, as the node's muted icon says: Sigma, Crosshair or Tag (components/split-token). */
export type ValueKind = "formula" | "measure" | "header"
export type GroupedValue = { text: string; cells?: string[]; kind?: ValueKind; formula?: string }

const specOf = (catalog: Catalog, task: Instance | undefined) => catalog.tasks.find((s) => s.name === task?.task)

/** The value connection into a parameter, wherever it lands (a pset node feeding its pset), and the id its value is resolved under. */
function linkOf(map: TaskMap, task: Instance, key: string, owner: string) {
  const direct = map.connections.find((c) => c.target === task.id && c.role === PARAM_HANDLE + key)
  if (direct) return { connection: direct, id: direct.id }
  const shared = owner ? psetSource(map, task.id, owner) : undefined
  const held = shared?.draft.pset && `${shared.draft.pset.name}.${key.slice(key.lastIndexOf(".") + 1)}`
  const through = held ? map.connections.find((c) => c.target === shared!.id && c.role === PARAM_HANDLE + held) : undefined
  return through ? { connection: through, id: `${through.id}:${task.id}` } : undefined
}

export function groupedValue(map: TaskMap, catalog: Catalog, task: Instance, key: string, groups: SplitGroup[] = [],
  values?: ValueResponse, seen: string[] = []): GroupedValue {
  const entries = parameterEntries(catalog, task)
  const entry = entries.get(key)
  if (!entry) return { text: "" }
  const many = groups.length > 1
  const formula = task.draft.formulas?.[key]
  if (formula?.trim() && !seen.includes(key)) {
    // A name reads the task's parameter of that name in the same group.
    const read = (group: SplitGroup | undefined) => (name: string) => {
      const other = [...entries.keys()].find((k) => k === name || k.slice(k.lastIndexOf(".") + 1) === name)
      if (!other) return undefined
      const value = groupedValue(map, catalog, task, other, group ? [group] : [], values, [...seen, key])
      return value.cells?.[0] ?? value.text
    }
    const cells = many ? groups.map((g) => formulaValue(formula, read(g)) ?? "") : undefined
    return { text: cells ? cells[0] : formulaValue(formula, read(groups[0])) ?? "", ...(cells ? { cells } : {}), kind: "formula", formula }
  }
  const own = task.draft.groupValues?.[key]
  // A pset fed by a pset node holds that node's values.
  const shared = entry.owner ? psetSource(map, task.id, entry.owner) : undefined
  const stored = shared?.draft.pset ? storedValue(shared, { ...entry, owner: shared.draft.pset.name }) : storedValue(task, entry)
  if (own && groups.length) {
    const cells = groups.map((g) => own[g.id] ?? stored)
    return many ? { text: cells[0], cells } : { text: cells[0] }
  }
  const link = linkOf(map, task, key, entry.owner)
  if (!link || link.connection.source.kind === "files") return { text: stored }
  const from = map.tasks.find((t) => t.id === (link.connection.source.kind !== "files" ? link.connection.source.taskId : ""))
  const run = specOf(catalog, from)?.run
  const kind: ValueKind | undefined = run === "value-header" ? "header" : run === "value-compute" ? "formula" : run ? undefined : "measure"
  const output = `${from?.id}:${link.connection.source.outputRole?.slice(VALUE_HANDLE.length)}`
  const one = (id: string) => {
    const taken = values?.parameters[id]
    return taken && taken.error === undefined ? formatScalar(taken.value) : undefined
  }
  const text = one(link.id) ?? formatValue(values?.outputs[output])
  if (!groups.length) return { text, ...(kind ? { kind } : {}) }
  const cells = groups.map((g) => one(`${link.id}@${g.id}`) ?? (many ? "" : text))
  return many ? { text: cells[0], cells, ...(kind ? { kind } : {}) } : { text: cells[0] || text, ...(kind ? { kind } : {}) }
}
