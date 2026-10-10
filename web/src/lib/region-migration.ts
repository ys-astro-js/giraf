/**
 * Older documents' loop regions (반복 영역) become split tasks when a document
 * opens (lib/splits). A region was a task whose id is also its group's
 * (`giraf.foreach`, and before it `giraf.for` and `giraf.if`), with settings
 * in `draft.flow = {criteria, split, condition}` and, on each connection
 * crossing its border, `flow[region id] = {mode: all|match, keys}`.
 *
 * A region that wraps exactly one task, whose split source feeds that task and
 * whose criteria are header keywords, N장씩 or 파일마다 becomes that task's
 * split on the input the source feeds: keyword → {key}, count → {per},
 * each → {each}. Its connections' `match` modes become pairing by their first
 * key and `all` becomes IRAF에 맡기기. Anything else is unwrapped: the tasks
 * stay, marked `migrated` so a warning asks for the split and pairing again.
 */
import type { Connection, Instance, TaskMap } from "./task-map/model"
import type { Catalog } from "./workbench"
import type { PairRule, SplitPart } from "./splits"

type OldCriterion = { keyword?: string; expression?: string; name?: string; count?: number; order?: string; each?: boolean; times?: number }
type OldFlow = { criteria?: OldCriterion[]; split?: { taskId: string; outputRole?: string }; condition?: string }
type OldConnection = Connection & { flow?: Record<string, { mode: "all" | "match"; keys?: string[] }>; widened?: true; targetGroup?: unknown }
type OldInstance = Instance & { firstRound?: unknown; roundValues?: unknown; firstPass?: unknown; firstPassValues?: unknown }

const REGION_TASKS = new Set(["giraf.foreach", "giraf.for", "giraf.if"])
const flowOf = (task: Instance) => (task.draft as { flow?: OldFlow }).flow
const sourceId = (c: Connection) => (c.source.kind !== "files" ? c.source.taskId : undefined)

/** A region: its task's id is also a group's. */
const isRegion = (map: TaskMap, task: Instance) =>
  !!map.subflows?.some((g) => g.id === task.id) && (REGION_TASKS.has(task.task) || !!flowOf(task))

/** The label names a region's criteria put in output names (`{EXPTIME}`, `{묶음}`, `{파일}`). */
function labels(flow: OldFlow): string[] {
  return (flow.criteria ?? []).map((c) => c.keyword ?? (c.expression !== undefined ? c.name ?? "" : c.count !== undefined ? "묶음" : c.each ? "파일" : "회차"))
}

/** `Dark{EXPTIME}_{묶음}.fits` is `Dark.fits`: a group's suffix names it now. */
function withoutLabels(task: Instance, names: string[]): Instance {
  const strip = (text: string) => names.reduce((name, label) => name.replaceAll(`{${label}}`, ""), text).replace(/[_-]+(?=\.|$)/, "")
  const d = task.draft
  return {
    ...task,
    draft: {
      ...d,
      ...(d.outputs ? { outputs: Object.fromEntries(Object.entries(d.outputs).map(([k, v]) => [k, strip(v)])) } : {}),
      output: { ...d.output, name: strip(d.output.name) },
    },
  }
}

function parts(flow: OldFlow): SplitPart[] | undefined {
  const found: SplitPart[] = []
  for (const c of flow.criteria ?? []) {
    if (c.keyword) found.push({ key: c.keyword })
    else if (c.count !== undefined && (!c.order || c.order === "name")) found.push({ per: Math.max(1, Math.floor(c.count)) })
    else if (c.each) found.push({ each: true })
    else return undefined
  }
  return found.length && !flow.condition?.trim() ? found : undefined
}

function migrateRegion(map: TaskMap, region: Instance): TaskMap {
  const flow = flowOf(region) ?? {}
  const members = map.tasks.filter((t) => t.subflowId === region.id)
  const parent = region.subflowId
  const connections = map.connections as OldConnection[]
  const by = parts(flow)
  const member = members.length === 1 ? members[0] : undefined
  const into = member && flow.split?.taskId
    ? connections.find((c) => c.target === member.id && sourceId(c) === flow.split!.taskId &&
      (!flow.split!.outputRole || c.source.kind === "files" || !c.source.outputRole || c.source.outputRole === flow.split!.outputRole))
    : undefined
  const converted = by && member && into && !member.draft.split
  const tasks = map.tasks.flatMap((t): Instance[] => {
    if (t.id === region.id) return []
    if (t.subflowId !== region.id) return [t]
    const moved: Instance = { ...t, subflowId: parent }
    if (!converted) return [{ ...moved, migrated: true }]
    const pairing: Record<string, PairRule> = { ...t.draft.pairing }
    for (const c of connections)
      if (c.target === t.id && c !== into && c.flow?.[region.id]) {
        const mode = c.flow[region.id]
        pairing[c.role] = mode.mode === "match" && mode.keys?.length ? { by: mode.keys[0] } : { iraf: true }
      }
    // A value from the region (its round's value) has no source now.
    const lostValue = connections.some((c) => c.target === t.id && sourceId(c) === region.id)
    const named = withoutLabels(moved, labels(flow))
    return [{
      ...named,
      draft: { ...named.draft, split: { input: into!.role, by: by! }, ...(Object.keys(pairing).length ? { pairing } : {}) },
      ...(lostValue ? { migrated: true as const } : {}),
    }]
  })
  return {
    ...map,
    tasks,
    subflows: map.subflows?.filter((g) => g.id !== region.id),
    connections: connections.filter((c) => c.target !== region.id && sourceId(c) !== region.id),
  }
}

/** Open an older document: its loop regions become split tasks or are unwrapped. */
export function migrateRegions(map: TaskMap, catalog: Catalog): TaskMap {
  void catalog
  let next = map
  // Inner regions first: a region holding another is migrated once that one is.
  for (;;) {
    const regions = next.tasks.filter((t) => isRegion(next, t))
    const inner = regions.find((r) => !regions.some((o) => o.subflowId === r.id))
    if (!inner) break
    next = migrateRegion(next, inner)
  }
  const stale = (value: object, keys: string[]) => keys.some((k) => k in value)
  const old = (draft: object) => stale(draft, ["flow", "partition", "partitionValues"])
  if (next === map && !map.connections.some((c) => stale(c, ["flow", "widened", "targetGroup"])) &&
    !map.tasks.some((t) => stale(t, ["firstRound", "roundValues", "firstPass", "firstPassValues"]) || old(t.draft) ||
      t.draft.valueRows?.some((r) => "groups" in r)))
    return map
  return {
    ...next,
    connections: (next.connections as OldConnection[]).map((c) => {
      const { flow: _f, widened: _w, targetGroup: _t, ...rest } = c
      void _f
      void _w
      void _t
      return rest
    }),
    tasks: (next.tasks as OldInstance[]).map((t) => {
      const { firstRound: _a, roundValues: _b, firstPass: _c, firstPassValues: _d, ...rest } = t
      void _a
      void _b
      void _c
      void _d
      const { flow: _f, partition: _p, partitionValues: _v, ...draft } = t.draft as Instance["draft"] & { flow?: unknown; partition?: unknown; partitionValues?: unknown }
      void _f
      void _p
      void _v
      return {
        ...rest,
        draft: { ...draft, ...(draft.valueRows ? { valueRows: draft.valueRows.map(({ name, value }) => ({ name, value })) } : {}) },
      }
    }),
  }
}
