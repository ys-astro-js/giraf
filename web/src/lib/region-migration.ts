/**
 * Older loops become loop regions when a document opens (docs/node-structure-brief.md §7).
 *
 * Before regions, a 각각 반복 took its files on an `items` input and handed
 * them to members through `이번 파일` (`item`); members' outputs went back
 * through `결과` (`result`) and left by `results`. A 반복 (`giraf.for`) ran a
 * number range and a 조건 분기 (`giraf.if`) routed files to 참 and 거짓 lanes.
 * Output ports could be split by a header keyword (묶음 포트) and calibration
 * inputs and outputs by filter and exposure (보정 그룹 포트).
 *
 * Here keywords become keyword criteria, the source on `items` becomes the
 * region's split, connections through the item, lane and result ports become
 * connections from their source to their target, a range becomes `N번`, a
 * condition stays the region's condition (the 거짓 lane's tasks go to a second
 * region with the opposite one), and a connection that took one member of a
 * split or calibration port becomes a plain connection.
 */
import { uid, type Connection, type Instance, type Source, type TaskMap } from "./task-map/model"
import { EACH_LABEL, TIMES_LABEL, isFlowSpec, labelName, type Criterion, type FlowSettings } from "./containers"
import { VALUE_HANDLE } from "./values"
import type { Catalog } from "./workbench"

/** The node kinds regions replace; their schemas are gone, so only their names say what they were. */
const LEGACY_RUNS: Record<string, "for" | "if"> = { "giraf.for": "for", "giraf.if": "if" }
const FOREACH = "giraf.foreach"
const ITEMS = "items", ITEM = "item", COLLECT = "result", RESULTS = "results"
const LANES = { then: "then", else: "else" }

type OldFlow = FlowSettings & { variable?: string; keywords?: string[]; partition?: unknown; start?: string; end?: string; step?: string }
type OldSource = Source & { group?: unknown; partition?: { keyword: string; value: string } }

const sourceId = (source: Source) => (source.kind !== "files" ? source.taskId : undefined)
const plain = (source: Source): Source => {
  const { group: _g, partition: _p, ...rest } = source as OldSource
  void _g
  void _p
  return rest as Source
}

/** How many numbers a range from `start` to `end` by `step` has (giraf/flows.py had flow_range). */
function rangeCount(flow: OldFlow): number {
  const [start, end, step] = [flow.start, flow.end, flow.step || "1"].map((v) => Number(v))
  if (![start, end, step].every(Number.isFinite) || step === 0 || (end - start) * step < 0) return 1
  return Math.min(1000, Math.floor((end - start) / step + 1e-9) + 1)
}

/** Old regions: a 각각 반복 still written with variables, and every 반복 and 조건 분기. */
function legacyRun(task: Instance, catalog: Catalog): "foreach" | "for" | "if" | undefined {
  if (LEGACY_RUNS[task.task]) return LEGACY_RUNS[task.task]
  const flow = task.draft.flow as OldFlow | undefined
  const foreach = task.task === FOREACH || isFlowSpec(catalog.tasks.find((s) => s.name === task.task))
  return foreach && flow && !Array.isArray(flow.criteria) ? "foreach" : undefined
}

/** The keywords an old 각각 반복 ran by: chosen on it, an older `partition`, or its list's split port. */
function oldKeywords(map: TaskMap, task: Instance, items: Connection[]): string[] {
  const flow = task.draft.flow as OldFlow
  if (Array.isArray(flow.keywords)) return flow.keywords
  if (typeof flow.partition === "string" && flow.partition) return [flow.partition]
  const from = items[0]?.source as OldSource | undefined
  if (!from || from.kind === "files" || from.partition) return []
  const source = map.tasks.find((t) => t.id === from.taskId)
  const ports = (source?.outputPorts ?? []) as { id: string; outputRole?: string; partition?: { keyword: string } }[]
  const port = ports.find((p) => p.partition && (from.port === "output" ? p.id === "$default" : from.port === `output:${p.outputRole}` ||
    from.port === `output-custom:${p.id}` || (!from.port && (p.outputRole === from.outputRole || p.id === "$default"))))
  return port?.partition ? [port.partition.keyword] : []
}

/** Members an `if` lane reaches, through other members. */
function laneMembers(map: TaskMap, id: string, lane: string): Set<string> {
  const members = new Set(map.tasks.filter((t) => t.subflowId === id).map((t) => t.id))
  const reached = new Set<string>()
  const stack = map.connections.filter((c) => sourceId(c.source) === id && c.source.kind !== "files" && c.source.outputRole === lane &&
    members.has(c.target)).map((c) => c.target)
  while (stack.length) {
    const next = stack.pop()!
    if (reached.has(next)) continue
    reached.add(next)
    stack.push(...map.connections.filter((c) => sourceId(c.source) === next && members.has(c.target)).map((c) => c.target))
  }
  return reached
}

/** Output names that read the old variable read the region's label. */
function renameVariable(task: Instance, from: string | undefined, to: string | undefined): Instance {
  if (!from || !to || from === to) return task
  const swap = (text: string) => text.replaceAll(`{${from}}`, `{${to}}`)
  const d = task.draft
  return {
    ...task,
    draft: {
      ...d,
      outputs: d.outputs && Object.fromEntries(Object.entries(d.outputs).map(([k, v]) => [k, swap(v)])),
      output: { ...d.output, name: swap(d.output.name) },
    },
  }
}

function migrateOne(map: TaskMap, catalog: Catalog, region: Instance): TaskMap {
  const run = legacyRun(region, catalog)!
  const id = region.id
  const flow = (region.draft.flow ?? {}) as OldFlow
  const input = run === "if" ? "input" : ITEMS
  const items = map.connections.filter((c) => c.target === id && c.role === input)
  const split = items.find((c) => sourceId(c.source))
  const splitSource = split ? plain(split.source) : undefined
  let criteria: Criterion[] = []
  let condition = ""
  if (run === "foreach") {
    const keywords = oldKeywords(map, region, items)
    criteria = keywords.length ? keywords.map((keyword) => ({ keyword })) : [{ each: true }]
  } else if (run === "for") criteria = [{ times: rangeCount(flow) }]
  else condition = flow.condition?.trim() ?? ""
  const keys = criteria.flatMap((c) => ("keyword" in c ? [c.keyword] : []))
  const labels = criteria.map(labelName)
  const connections: Connection[] = []
  const elseLane = run === "if" ? laneMembers(map, id, LANES.else) : new Set<string>()
  const elseId = elseLane.size ? uid() : undefined
  for (const c of map.connections) {
    const from = sourceId(c.source)
    if (c.target === id) continue // The list, a condition value and collected results: no ports now.
    if (from === id && c.source.kind !== "files") {
      const role = c.source.outputRole ?? ""
      if (role === ITEM || role === LANES.then || role === LANES.else) {
        // The current file: every list source straight to the member; the split one divides.
        for (const item of items) {
          const other = item !== split && !!sourceId(item.source)
          const region = role === LANES.else && elseId ? elseId : id
          connections.push({
            id: uid(), target: c.target, role: c.role, source: plain(item.source),
            ...(other ? { flow: { [region]: keys.length ? { mode: "match" as const, keys } : { mode: "all" as const, keys: [] } } } : {}),
          })
        }
        continue
      }
      if (role === RESULTS) {
        // Every round's results: each collected member output, straight to the target.
        for (const collect of map.connections.filter((x) => x.target === id && x.role === COLLECT))
          connections.push({ id: uid(), target: c.target, role: c.role, source: plain(collect.source) })
        continue
      }
      if (role.startsWith(VALUE_HANDLE) && run === "for") {
        connections.push({ ...c, source: { ...c.source, outputRole: VALUE_HANDLE + TIMES_LABEL } })
        continue
      }
      continue
    }
    // Another list source reaching a member directly paired by the keywords, as on the list.
    const listed = items.some((item) => item !== split && sourceId(item.source) === from)
    const member = map.tasks.find((t) => t.id === c.target)?.subflowId === id
    if (from && listed && member && keys.length && !c.flow?.[id]) {
      connections.push({ ...c, flow: { ...c.flow, [id]: { mode: "match", keys } } })
      continue
    }
    connections.push(c)
  }
  // A 각각 반복 by file had one name for the file; a range, one for its number.
  const renamed = run === "foreach" && !keys.length ? EACH_LABEL : run === "for" ? TIMES_LABEL : undefined
  const variable = flow.variable && !labels.includes(flow.variable) ? flow.variable : undefined
  const settings: FlowSettings = { criteria, ...(splitSource && sourceId(splitSource) ? { split: { taskId: sourceId(splitSource)!, ...(splitSource.kind !== "files" && splitSource.outputRole ? { outputRole: splitSource.outputRole } : {}) } } : {}), ...(condition ? { condition } : {}) }
  const group = map.subflows?.find((g) => g.id === id)
  let tasks = map.tasks.map((t) => {
    if (t.id === id) {
      const { passed: _, ...rest } = t
      void _
      return { ...rest, task: FOREACH, draft: { ...t.draft, flow: settings } }
    }
    if (t.subflowId !== id) return t
    const moved = elseLane.has(t.id) ? { ...t, subflowId: elseId } : t
    return renameVariable(moved, variable, renamed ?? (labels.length === 1 ? labels[0] : undefined))
  })
  let subflows = map.subflows
  if (elseId && group) {
    // The 거짓 lane is a region of its own, with the opposite condition, below the first.
    const opposite = { ...region, id: elseId, label: `${region.label} 아님`, task: FOREACH,
      draft: { ...region.draft, flow: { ...settings, condition: `!(${condition})` } }, position: undefined }
    delete opposite.passed
    tasks = [...tasks, opposite]
    subflows = [...(subflows ?? []), { ...group, id: elseId, name: opposite.label, collapsed: undefined,
      position: { x: group.position.x, y: group.position.y + group.height + 40 } }]
  }
  return { ...map, tasks, subflows, connections }
}

/** Open an older document: old loops become regions, split and calibration ports plain outputs. */
export function migrateRegions(map: TaskMap, catalog: Catalog): TaskMap {
  let next = map
  for (const task of map.tasks)
    if (map.subflows?.some((g) => g.id === task.id) && legacyRun(task, catalog)) next = migrateOne(next, catalog, task)
  const stale = (value: object, keys: string[]) => keys.some((k) => k in value)
  if (next === map && !map.connections.some((c) => stale(c, ["targetGroup"]) || stale(c.source, ["group", "partition"])) &&
    !map.tasks.some((t) => stale(t, ["firstPass", "firstPassValues"]) || t.outputPorts?.some((p) => stale(p, ["partition", "open"])) ||
      Object.keys(t.passed ?? {}).some((k) => k.includes("~"))))
    return map
  return {
    ...next,
    connections: next.connections.map((c) => {
      const { targetGroup: _, ...rest } = c as Connection & { targetGroup?: unknown }
      void _
      return { ...rest, source: plain(c.source) }
    }),
    tasks: next.tasks.map((t) => {
      const { firstPass: _a, firstPassValues: _b, ...rest } = t as Instance & { firstPass?: unknown; firstPassValues?: unknown }
      void _a
      void _b
      // A value node's 나누기 기준 is the files' labels now; a constant's table keeps its own.
      const spec = catalog.tasks.find((s) => s.name === t.task)
      const draft = t.draft.partition && spec?.run && spec.run !== "value-constant" ? { ...t.draft, partition: undefined } : t.draft
      return {
        ...rest,
        draft,
        ...(t.outputPorts ? { outputPorts: t.outputPorts.map((p) => {
          const { partition: _p, open: _o, ...port } = p as typeof p & { partition?: unknown; open?: unknown }
          void _p
          void _o
          return port
        }) } : {}),
        ...(t.passed ? { passed: Object.fromEntries(Object.entries(t.passed).filter(([k]) => !k.includes("~"))) } : {}),
      }
    }),
  }
}
