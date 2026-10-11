/**
 * Older documents' loop regions (반복 영역) become split tasks when a document
 * opens (lib/splits, docs/node-schema.md 예전 문서). A region was a task whose
 * id is also its group's (`giraf.foreach`, before it `giraf.for` and
 * `giraf.if`), with settings in `draft.flow = {criteria, split, condition}`
 * and, on a connection crossing its border, `flow[region id] = {mode, keys}`.
 *
 * Each task inside regions takes, by what feeds it:
 * - the region's split source: the criteria of the regions around it that
 *   split the same source, outer first, as its `split` (keyword → {key},
 *   N장씩 → {per}, 파일마다 → {each}); a condition `KEY == "V"` becomes a
 *   `select` and drops a key it leaves one value of;
 * - a task inside the same region: {each} on that input, one file per group;
 * - a task inside a region within its own: the keywords of its region's
 *   criteria, which the gathered results' headers still read;
 * other inputs with several files pair by order when they came from the same
 * split source (another task fed by it, or a region on it), by the chip's key
 * for `…로 짝`, and to IRAF for `모두에` from a split task. `{label}` marks in
 * output names are removed; a group's suffix names its outputs now.
 *
 * A region of `N번`, an expression, an order by keyword or another condition
 * cannot be said this way: it is unwrapped and its tasks are marked
 * `migrated` so a warning asks for the split and pairing again. So is a task
 * that loses a value the region gave it (`value:<label>`).
 * Value nodes' per-filter tables (`partition`, rows' `groups`) become their
 * `groupValues`.
 */
import type { Connection, Instance, TaskMap } from "./task-map/model"
import type { Catalog } from "./workbench"
import type { PairRule, SelectRule, SplitPart } from "./splits"

type OldCriterion = { keyword?: string; expression?: string; name?: string; count?: number; order?: string; each?: boolean; times?: number }
type OldFlow = { criteria?: OldCriterion[]; split?: { taskId: string; outputRole?: string }; condition?: string }
type OldConnection = Connection & { flow?: Record<string, { mode: "all" | "match"; keys?: string[] }>; widened?: true; targetGroup?: unknown }
type OldInstance = Instance & { firstRound?: unknown; roundValues?: unknown; firstPass?: unknown; firstPassValues?: unknown }
type OldDraft = Instance["draft"] & { flow?: OldFlow; partition?: string; partitionValues?: string[] }
type OldRow = { name: string; value: string; groups?: Record<string, string> }

const REGION_TASKS = new Set(["giraf.foreach", "giraf.for", "giraf.if"])
const flowOf = (task: Instance) => (task.draft as OldDraft).flow
const sourceId = (c: Connection) => (c.source.kind !== "files" ? c.source.taskId : undefined)
const isValueRole = (role: string) => role.startsWith("p:") || role.startsWith("pset:")

/** A region: its task's id is also a group's. */
const isRegion = (map: TaskMap, task: Instance) =>
  !!map.subflows?.some((g) => g.id === task.id) && (REGION_TASKS.has(task.task) || !!flowOf(task))

/** The label names a region's criteria put in output names (`{EXPTIME}`, `{묶음}`, `{파일}`). */
const labels = (flow: OldFlow) =>
  (flow.criteria ?? []).map((c) => c.keyword ?? (c.expression !== undefined ? c.name ?? "" : c.count !== undefined ? "묶음" : c.each ? "파일" : "회차"))

/** `KEY == "V"` (or `'V'`, or a bare value) as a selection; anything else cannot be said. */
function conditionSelect(text: string | undefined): SelectRule | null | undefined {
  const condition = text?.trim()
  if (!condition) return undefined
  const m = /^([A-Za-z_][\w-]*)\s*==\s*(?:"([^"]*)"|'([^']*)'|([\w.+-]+))$/.exec(condition)
  return m ? { key: m[1], values: [m[2] ?? m[3] ?? m[4]] } : null
}

/** The parts a region's criteria say, or undefined when one cannot be said. */
function partsOf(flow: OldFlow): SplitPart[] | undefined {
  const found: SplitPart[] = []
  for (const c of flow.criteria ?? []) {
    if (c.keyword) found.push({ key: c.keyword })
    else if (c.count !== undefined && (!c.order || c.order === "name")) found.push({ per: Math.max(1, Math.floor(c.count)) })
    else if (c.each) found.push({ each: true })
    else return undefined
  }
  return found
}

/** `Dark{EXPTIME}_{묶음}.fits` is `Dark.fits`: a group's suffix names it now. */
function withoutLabels(draft: Instance["draft"], names: string[]): Instance["draft"] {
  const strip = (text: string) => names.reduce((name, label) => name.replaceAll(`{${label}}`, ""), text).replace(/[_-]+(?=\.|$)/, "")
  return {
    ...draft,
    ...(draft.outputs ? { outputs: Object.fromEntries(Object.entries(draft.outputs).map(([k, v]) => [k, strip(v)])) } : {}),
    output: { ...draft.output, name: strip(draft.output.name) },
  }
}

/** The regions around a task or region, outermost first. */
function chainOf(map: TaskMap, regions: Map<string, Instance>, id: string | undefined): Instance[] {
  const found: Instance[] = []
  let current = map.tasks.find((t) => t.id === id)?.subflowId
  while (current && regions.has(current) && !found.some((r) => r.id === current)) {
    found.unshift(regions.get(current)!)
    current = regions.get(current)!.subflowId
  }
  return found
}

const sameSource = (a: OldFlow, b: OldFlow) =>
  !!a.split?.taskId && a.split.taskId === b.split?.taskId && (a.split.outputRole ?? "") === (b.split?.outputRole ?? "")

/** The criteria a region's rounds ran by: those of the regions around it splitting the same source, then its own. */
function criteriaOf(chain: Instance[]): { parts?: SplitPart[]; select?: SelectRule; names: string[] } {
  const own = flowOf(chain.at(-1)!) ?? {}
  const used = chain.filter((r) => r === chain.at(-1) || sameSource(flowOf(r) ?? {}, own))
  let parts: SplitPart[] | undefined = []
  let select: SelectRule | undefined
  const names: string[] = []
  for (const region of used) {
    const flow = flowOf(region) ?? {}
    const more = partsOf(flow)
    const chosen = conditionSelect(flow.condition)
    if (!more || chosen === null || region.task === "giraf.for" || region.task === "giraf.if") return { names }
    parts = [...parts!, ...more]
    names.push(...labels(flow))
    if (chosen) select = chosen
  }
  // A key the selection leaves one value of makes one group: no split by it.
  if (select && select.values.length === 1) parts = parts!.filter((p) => !("key" in p && p.key === select!.key))
  return { parts, select, names }
}

const fromSplit = (c: Connection, flow: OldFlow) =>
  !!flow.split?.taskId && sourceId(c) === flow.split.taskId &&
  (c.source.kind === "files" || !flow.split.outputRole || !c.source.outputRole || c.source.outputRole === flow.split.outputRole)

/** Open an older document: its loop regions become split tasks, or are unwrapped with a warning. */
export function migrateRegions(map: TaskMap, catalog: Catalog): TaskMap {
  const regions = new Map(map.tasks.filter((t) => isRegion(map, t)).map((t) => [t.id, t]))
  const stale = (value: object, keys: string[]) => keys.some((k) => k in value)
  const oldDraft = (draft: object) => stale(draft, ["flow", "partition", "partitionValues"])
  if (!regions.size && !map.connections.some((c) => stale(c, ["flow", "widened", "targetGroup"])) &&
    !map.tasks.some((t) => stale(t, ["firstRound", "roundValues", "firstPass", "firstPassValues"]) || oldDraft(t.draft) ||
      t.draft.valueRows?.some((r) => "groups" in r)))
    return map
  const connections = map.connections as OldConnection[]
  const chains = new Map(map.tasks.map((t) => [t.id, chainOf(map, regions, t.id)]))
  // Whether a task's files came from a split source, as a region's rounds or a task fed by one.
  const derived = (id: string | undefined, source: OldFlow, seen = new Set<string>()): boolean => {
    if (!id || seen.has(id)) return false
    seen.add(id)
    if (id === source.split?.taskId) return true
    if ((chains.get(id) ?? []).some((r) => sameSource(flowOf(r) ?? {}, source))) return true
    return connections.some((c) => c.target === id && !isValueRole(c.role) && derived(sourceId(c), source, seen))
  }
  const results = new Map<string, Instance>()
  const order = (task: Instance) => {
    const inputs = catalog.tasks.find((s) => s.name === task.task)?.inputs.map((s) => s.name) ?? []
    return (a: Connection, b: Connection) =>
      (inputs.includes(a.role) ? inputs.indexOf(a.role) : 99) - (inputs.includes(b.role) ? inputs.indexOf(b.role) : 99)
  }
  for (const task of map.tasks) {
    const chain = chains.get(task.id)!
    if (regions.has(task.id) || !chain.length) continue
    const region = chain.at(-1)!
    const flow = flowOf(region) ?? {}
    const { parts, select, names } = criteriaOf(chain)
    const incoming = connections.filter((c) => c.target === task.id && !isValueRole(c.role) && c.source.kind !== "files").sort(order(task))
    const ofKind = (c: Connection) => {
      const from = sourceId(c)
      if (fromSplit(c, flow)) return "split"
      const around = chains.get(from ?? "") ?? []
      if (!from || !around.length || !around.includes(region) && !chain.every((r, i) => around[i] === r)) return "boundary"
      if (around.at(-1) === region) return "each"
      if (chain.every((r, i) => around[i] === r) && around.length > chain.length) return "gather"
      return "boundary"
    }
    const kinds = incoming.map((c) => ({ c, kind: ofKind(c) }))
    const lostValue = connections.some((c) => c.target === task.id && regions.has(sourceId(c) ?? ""))
    const keys = (parts ?? []).filter((p) => "key" in p)
    const chosen = parts === undefined ? undefined
      : kinds.find((k) => k.kind === "split") ?? kinds.find((k) => k.kind === "gather") ?? kinds.find((k) => k.kind === "each")
    const by: SplitPart[] | undefined = !chosen ? undefined
      : chosen.kind === "split" ? parts
      : chosen.kind === "gather" ? (keys.length ? keys : [{ each: true }])
      : [{ each: true }]
    const draft: Instance["draft"] = { ...withoutLabels(task.draft, names.length ? names : labels(flow)) }
    if (chosen && by && (by.length || select)) {
      if (by.length && !task.draft.split) draft.split = { input: chosen.c.role, by }
      if (select && chosen.kind === "split") draft.select = { ...draft.select, [chosen.c.role]: select }
      const pairing: Record<string, PairRule> = { ...task.draft.pairing }
      for (const { c, kind } of kinds) {
        if (c === chosen.c || !by.length || pairing[c.role]) continue
        const stored = chain.map((r) => c.flow?.[r.id]).filter(Boolean).at(-1)
        const around = chains.get(sourceId(c) ?? "") ?? []
        // A source split by its own region gives several files; a source of one file needs no rule.
        const sourceSplit = around.length > 0 && (criteriaOf(around).parts?.length ?? 0) > 0
        if (kind !== "boundary" || (!stored && derived(sourceId(c), flow))) pairing[c.role] = { order: true }
        else if (stored?.mode === "match" && stored.keys?.length) pairing[c.role] = { by: stored.keys[0] }
        else if (stored?.mode === "all" && sourceSplit && derived(sourceId(c), flow)) pairing[c.role] = { iraf: true }
      }
      if (Object.keys(pairing).length) draft.pairing = pairing
    }
    const converted = !!chosen && !!by && (by.length > 0 || !!select)
    results.set(task.id, { ...task, draft, subflowId: undefined, ...(!converted || lostValue ? { migrated: true as const } : {}) })
  }
  // Tasks leave their regions for the plain group around the outermost one.
  const outside = (id: string | undefined): string | undefined => (id && regions.has(id) ? outside(regions.get(id)!.subflowId) : id)
  const tasks = map.tasks.flatMap((t): Instance[] => {
    if (regions.has(t.id)) return []
    const done = results.get(t.id) ?? t
    const { subflowId: _, ...rest } = done
    void _
    const parent = outside(t.subflowId)
    return [parent ? { ...rest, subflowId: parent } : rest]
  })
  return {
    ...map,
    subflows: map.subflows?.filter((g) => !regions.has(g.id)),
    connections: connections
      .filter((c) => !regions.has(c.target) && !regions.has(sourceId(c) ?? ""))
      .map((c) => {
        const { flow: _f, widened: _w, targetGroup: _t, ...rest } = c
        void _f
        void _w
        void _t
        return rest
      }),
    tasks: (tasks as OldInstance[]).map((t) => {
      const { firstRound: _a, roundValues: _b, firstPass: _c, firstPassValues: _d, ...rest } = t
      void _a
      void _b
      void _c
      void _d
      const { flow: _f, partition, partitionValues: _v, ...draft } = t.draft as OldDraft
      void _f
      void _v
      const rows = draft.valueRows as OldRow[] | undefined
      // A value node's per-filter table: a value per group of the tasks it feeds.
      const groupValues = { ...draft.groupValues }
      if (partition) for (const row of rows ?? []) if (row.groups && Object.keys(row.groups).length) groupValues[row.name] = { ...row.groups }
      return {
        ...rest,
        draft: {
          ...draft,
          ...(rows ? { valueRows: rows.map(({ name, value }) => ({ name, value })) } : {}),
          ...(Object.keys(groupValues).length ? { groupValues } : {}),
        },
      }
    }),
  }
}
