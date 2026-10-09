/**
 * Loop regions (docs/node-structure-brief.md §3.5, docs/node-schema.md).
 *
 * A region is a GIRAF node (node schema `giraf.foreach`, flow component
 * `foreach`) drawn as a group: the task instance and its subflow share one id,
 * members are the tasks in that group (an inner region is a member whose own
 * group nests in it), and its settings live in `draft.flow`:
 *
 *   criteria   what each round is: {keyword}, {expression, name}, {count, order}, {each}, {times}
 *   split      the source whose files the rounds divide ({taskId, outputRole})
 *   condition  only the split files this IRAF expression holds for
 *
 * A region has no boundary ports. Outside sources connect straight to member
 * inputs; a connection crossing a region's border receives as stored in
 * `Connection.flow[region id]`, or by default (receiveMode). Results made in a
 * round carry its values as labels; leaving the region, every round's results
 * are one list. The region's `value:<label>` outputs give members the round's
 * value. The server runs it (giraf/workflow.py, giraf/flows.py).
 */
import { makeInstance, type Connection, type Instance, type Subflow, type TaskMap } from "./task-map/model"
import { resolvedSource } from "./task-map/runs"
import { isContainerId } from "./flow-graph"
import { fitGroups } from "./group-nesting"
import { evaluateExpression, expressionText } from "./flow-expression"
import { isValueRole, VALUE_HANDLE } from "./values"
import { withMeans, withSubject } from "./korean"
import type { Catalog, Draft, Frame, Preferences, Spec } from "./workbench"

export { isContainerId }
export const FLOW_RUNS = ["foreach"] as const
export type FlowRun = (typeof FLOW_RUNS)[number]
export type Criterion =
  | { keyword: string }
  | { expression: string; name: string }
  | { count: number; order: string }
  | { each: true }
  | { times: number }
export type FlowSplit = { taskId: string; outputRole?: string }
export type FlowSettings = { criteria?: Criterion[]; split?: FlowSplit; condition?: string }
/** How a connection crossing a region's border receives; `나눠서` is the region's split. */
export type ReceiveMode = { mode: "all" | "match"; keys: string[] }
type Receive = { mode: "split" } | { mode: "match"; keys: string[] } | { mode: "all" }
/** The group heading's height (.subflow-heading); the body starts below it. */
export const FLOW_HEADER = 56
export const FLOW_ROW = 32
/** Value ports sit this far inside the region's border. */
export const FLOW_INSET = 20
export const CHUNK_LABEL = "묶음"
export const EACH_LABEL = "파일"
export const TIMES_LABEL = "회차"

export const isFlowSpec = (spec: Spec | undefined): spec is Spec & { run: FlowRun } => spec?.run === "foreach"
const specOf = (catalog: Catalog, task: Instance | undefined) => catalog.tasks.find((s) => s.name === task?.task)

/** The region task of a group, if the group is a region. */
export const containerTask = (map: TaskMap, id: string | undefined): Instance | undefined =>
  isContainerId(map, id) ? map.tasks.find((t) => t.id === id) : undefined
export function flowRun(map: TaskMap, catalog: Catalog, id: string | undefined): FlowRun | undefined {
  return isFlowSpec(specOf(catalog, containerTask(map, id))) ? "foreach" : undefined
}
export const containerMembers = (map: TaskMap, id: string) => map.tasks.filter((t) => t.subflowId === id)
export const flowSettings = (task: Instance | undefined): FlowSettings => task?.draft.flow ?? {}
export const criteriaOf = (task: Instance | undefined): Criterion[] => flowSettings(task).criteria ?? []

/** The label a criterion puts on results: its keyword, its expression's name, 묶음, 파일 or 회차. */
export function labelName(criterion: Criterion): string {
  if ("keyword" in criterion) return criterion.keyword
  if ("expression" in criterion) return criterion.name
  if ("count" in criterion) return CHUNK_LABEL
  if ("each" in criterion) return EACH_LABEL
  return TIMES_LABEL
}
export const flowLabels = (task: Instance | undefined) => criteriaOf(task).map(labelName)
/** A region divides files unless it only repeats a number of times. */
export const splitsFiles = (settings: FlowSettings) =>
  !!settings.condition?.trim() || (settings.criteria ?? []).some((c) => !("times" in c))

export function defaultFlowSettings(): FlowSettings {
  return { criteria: [] }
}

/** Regions around a task, outermost first. */
export function enclosingRegions(map: TaskMap, id: string | undefined): Instance[] {
  const found: Instance[] = []
  let current = map.tasks.find((t) => t.id === id)?.subflowId
  while (current && !found.some((r) => r.id === current)) {
    const region = containerTask(map, current)
    if (!region) break
    found.unshift(region)
    current = region.subflowId
  }
  return found
}
export const insideRegion = (map: TaskMap, id: string | undefined, region: string) =>
  enclosingRegions(map, id).some((r) => r.id === region)

/** The label names a task's results carry: those of the regions around it. */
export const sourceLabels = (map: TaskMap, id: string | undefined) =>
  enclosingRegions(map, id).flatMap((region) => flowLabels(region))

/**
 * How a connection crossing into `region` receives (giraf/flows.py
 * receive_mode): the split source divides; a stored mode wins; otherwise
 * labels its source carries under the region's label names match, and
 * anything else reaches every round as it is.
 */
export function receiveMode(map: TaskMap, connection: Pick<Connection, "source" | "flow">, region: Instance): Receive {
  const split = flowSettings(region).split
  const source = connection.source.kind !== "files" ? connection.source : undefined
  if (split?.taskId && source?.taskId === split.taskId &&
    (!split.outputRole || !source.outputRole || split.outputRole === source.outputRole))
    return { mode: "split" }
  const stored = connection.flow?.[region.id]
  if (stored) return stored.mode === "match" ? { mode: "match", keys: stored.keys } : { mode: "all" }
  const carried = sourceLabels(map, source?.taskId)
  const keys = flowLabels(region).filter((name) => carried.includes(name))
  return keys.length ? { mode: "match", keys } : { mode: "all" }
}

/** What the chip on a region's border says: `나눠서`, `모두에`, `FILTER, EXPTIME로 짝`. */
export function receiveText(mode: Receive): string {
  if (mode.mode === "split") return "나눠서"
  if (mode.mode === "all") return "모두에"
  return `${withMeans(mode.keys.join(", "))} 짝`
}

/**
 * The regions a connection crosses into, outermost first: those around its
 * target and not around its source. Leaving a region crosses nothing; a
 * region's own values start inside it.
 */
export function crossedRegions(map: TaskMap, connection: Pick<Connection, "source" | "target">): Instance[] {
  const from = connection.source.kind !== "files" ? connection.source.taskId : undefined
  return enclosingRegions(map, connection.target).filter((r) => r.id !== from && !(from && insideRegion(map, from, r.id)))
}

/** A chip menu's choice: the region's split, every round the same files, or one key to pair by toggled. */
export type ReceiveChoice = "split" | "all" | { key: string }
/**
 * Change how a connection receives at one region's border. `나눠서` makes its
 * source the region's split; leaving `나눠서` leaves the region without one.
 * Choosing settles a warning about the connection having been widened.
 */
export function chooseReceive(map: TaskMap, connectionId: string, regionId: string, choice: ReceiveChoice): TaskMap {
  const connection = map.connections.find((c) => c.id === connectionId)
  const region = map.tasks.find((t) => t.id === regionId)
  if (!connection || !region || connection.source.kind === "files" || !connection.source.taskId) return map
  const { taskId, outputRole } = connection.source
  const current = receiveMode(map, connection, region)
  const setSplit = (m: TaskMap, split: FlowSplit | undefined): TaskMap => ({
    ...m,
    tasks: m.tasks.map((t) => {
      if (t.id !== regionId) return t
      const { split: _, ...rest } = flowSettings(t)
      void _
      return { ...t, draft: { ...t.draft, flow: split ? { ...rest, split } : rest } }
    }),
  })
  let next: TaskMap = {
    ...map,
    connections: map.connections.map((c) => {
      if (c.id !== connectionId || !c.widened) return c
      const { widened: _, ...rest } = c
      void _
      return rest
    }),
  }
  if (choice === "split")
    return setReceiveMode(setSplit(next, { taskId, ...(outputRole ? { outputRole } : {}) }), connectionId, regionId, undefined)
  if (current.mode === "split") next = setSplit(next, undefined)
  if (choice === "all") return setReceiveMode(next, connectionId, regionId, { mode: "all", keys: [] })
  const keys = current.mode === "match" ? current.keys : []
  const toggled = flowLabels(region).filter((k) => (k === choice.key ? !keys.includes(k) : keys.includes(k)))
  return setReceiveMode(next, connectionId, regionId, toggled.length ? { mode: "match", keys: toggled } : { mode: "all", keys: [] })
}

const number = (text: string | undefined) => {
  if (text === undefined || text.trim() === "") return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

/**
 * A round's value as people read it and output names take it (giraf/values.py
 * pass_value): a whole number without decimals (15.0 is 15), otherwise the
 * trimmed text (30.66011, B).
 */
export function passValue(text: string): string {
  const value = number(text)
  return value !== undefined && Number.isInteger(value) ? String(value) : text.trim()
}

/** Values as a region compares them: as numbers when both read as one (15 is 15.0), otherwise as trimmed text. */
export function sameValue(a: string, b: string): boolean {
  const [x, y] = [number(a), number(b)]
  return x !== undefined && y !== undefined ? x === y : a.trim() === b.trim()
}

/** What a region reads of a file for a name: its label of that name, else its header. */
export const frameValue = (frame: Frame | undefined, name: string) =>
  String(frame?.labels?.[name] ?? frame?.headers?.[name] ?? "").trim()

const framesOf = (map: TaskMap, rows: Frame[]) =>
  new Map([...rows, ...map.runs.flatMap((r) => r.products)].map((f) => [f.id, f]))
export const loopFrames = framesOf

/** One round of a region: `B 30` and its files; `values` keep the text they were read as. */
export type FlowRound = { name: string; values: Record<string, string>; ids: string[] }
/** Kept for the pass wording in older modules. */
export type FlowPass = FlowRound
const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
function stem(label: string) {
  const base = label.split("/").at(-1) ?? ""
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}
const labelOf = (frames: Map<string, Frame>, id: string) => frames.get(id)?.label || frames.get(id)?.name || id

/** What an expression reads of a file for a name: its label, else its header (giraf/flows.py variables). */
const lookupOf = (frame: Frame | undefined) => (name: string) => {
  const value = frame?.labels?.[name] ?? frame?.headers?.[name]
  return value === undefined || value === null ? undefined : String(value)
}

/**
 * The rounds a region makes of `ids` (giraf/flows.py rounds), or undefined
 * when an expression or condition reads what the files here do not hold,
 * which only a run decides.
 */
export function roundsOf(ids: string[], frames: Map<string, Frame>, settings: FlowSettings): FlowRound[] | undefined {
  const criteria = settings.criteria ?? []
  const condition = settings.condition?.trim()
  if (condition) {
    const held = ids.map((id) => evaluateExpression(condition, lookupOf(frames.get(id))))
    if (held.some((v) => v === undefined)) return undefined
    ids = ids.filter((_, i) => (typeof held[i] === "string" ? held[i] !== "" : !!held[i]))
  }
  const evaluated = new Map<string, string>()
  for (const [k, criterion] of criteria.entries()) {
    if (!("expression" in criterion)) continue
    for (const id of ids) {
      const value = evaluateExpression(criterion.expression, lookupOf(frames.get(id)))
      if (value === undefined) return undefined
      evaluated.set(`${k}:${id}`, expressionText(value))
    }
  }
  // Each round: its values, its files and how values read differently to people.
  type Group = [Record<string, string>, string[], Record<string, string>]
  let groups: Group[] = ids.length || !splitsFiles(settings) ? [[{}, ids, {}]] : []
  for (const [k, criterion] of criteria.entries()) {
    const name = labelName(criterion)
    groups = groups.flatMap(([values, members, shown]): Group[] => {
      if ("times" in criterion)
        return Array.from({ length: Math.max(0, Math.floor(criterion.times)) }, (_, k) => [{ ...values, [name]: String(k + 1) }, members, shown])
      if ("count" in criterion) {
        const order = criterion.order || "name"
        const key = (id: string) => (order === "name" ? labelOf(frames, id) : frameValue(frames.get(id), order))
        const sorted = [...members].sort((a, b) => {
          const [x, y] = [number(key(a)), number(key(b))]
          return x !== undefined && y !== undefined ? x - y : compareText(key(a), key(b))
        })
        const size = Math.max(1, Math.floor(criterion.count))
        const chunks: Group[] = []
        for (let k = 0; k < sorted.length; k += size) {
          const end = Math.min(k + size, sorted.length)
          // Named by the files it takes, `1–5`; its value stays the chunk number.
          chunks.push([{ ...values, [name]: String(k / size + 1) }, sorted.slice(k, end), { ...shown, [name]: end - k > 1 ? `${k + 1}–${end}` : String(end) }])
        }
        return chunks
      }
      const found: [string, string[]][] = []
      for (const id of members) {
        const value = "keyword" in criterion ? frameValue(frames.get(id), criterion.keyword)
          : "expression" in criterion ? evaluated.get(`${k}:${id}`)!
          : stem(labelOf(frames, id))
        // 15 and 15.0 are one round, named as the first file has it.
        const group = found.find(([key]) => sameValue(key, value))
        if (group) group[1].push(id)
        else found.push([value, [id]])
      }
      return found.map(([value, group]) => [{ ...values, [name]: value }, group, shown])
    })
  }
  const names = criteria.map(labelName)
  return groups
    .sort(([a], [b]) => {
      for (const name of names) {
        const order = compareText(a[name], b[name])
        if (order) return order
      }
      return 0
    })
    .map(([values, members, shown]) => ({ name: roundName(values, shown), values, ids: members }))
}
/** How a round is named to people: its values in criteria order, `B 30`; a chunk reads as its files, `15 1–5`. */
export const roundName = (values: Record<string, string>, shown: Record<string, string> = {}) =>
  Object.entries(values).map(([name, v]) => shown[name] ?? (v.trim() ? passValue(v) : "없음")).join(" ")

/** A round's files in a few words: `Zero.fits` for one file, `5장` for images, `파일 3개` otherwise. */
export function passFilesText(ids: string[], frames: Map<string, Frame>, nameOne = true): string {
  if (nameOne && ids.length === 1) return labelOf(frames, ids[0])
  return ids.every((id) => (frames.get(id)?.asset ?? "image") === "image") ? `${ids.length}장` : `파일 ${ids.length}개`
}

type Context = { region: Instance; round: FlowRound }[]

/**
 * The files a connection delivers in the rounds of `context` it crosses
 * (giraf/workflow.py receive): `missing` names a round a match leaves empty.
 */
function through(map: TaskMap, connection: Pick<Connection, "source" | "flow">, ids: string[], context: Context, frames: Map<string, Frame>) {
  const source = connection.source.kind !== "files" ? connection.source.taskId : undefined
  for (const { region, round } of context) {
    if (source && insideRegion(map, source, region.id)) continue
    const mode = receiveMode(map, connection, region)
    if (mode.mode === "split") ids = round.ids.filter((id) => ids.includes(id))
    else if (mode.mode === "match") {
      ids = ids.filter((id) => mode.keys.every((k) => sameValue(frameValue(frames.get(id), k), round.values[k] ?? "")))
      if (!ids.length) return { ids, missing: round.name }
    }
  }
  return { ids, missing: undefined }
}

/** The split source's files known now; `waiting` while it has not run. */
export function splitFiles(map: TaskMap, task: Instance): { ids: string[]; waiting: boolean } {
  const split = flowSettings(task).split
  if (!split?.taskId) return { ids: [], waiting: false }
  const source = resolvedSource(map, { kind: "pending", taskId: split.taskId, ...(split.outputRole ? { outputRole: split.outputRole } : {}) })
  return source.kind === "pending" ? { ids: [], waiting: true } : { ids: source.ids, waiting: false }
}

/** The connection a region's split source reaches it by, for the regions around it. */
function splitConnection(map: TaskMap, region: Instance): Pick<Connection, "source" | "flow"> {
  const split = flowSettings(region).split!
  const into = map.connections.find((c) => c.source.kind !== "files" && c.source.taskId === split.taskId &&
    insideRegion(map, c.target, region.id))
  return into ?? { source: { kind: "pending", taskId: split.taskId, ...(split.outputRole ? { outputRole: split.outputRole } : {}) } }
}

/**
 * The rounds of a region known now, within the first round of each region
 * around it; undefined when the run decides them.
 */
export function regionRounds(map: TaskMap, task: Instance, rows: Frame[], context = firstContext(map, enclosingRegions(map, task.id), rows)): { rounds: FlowRound[] | undefined; waiting: boolean } {
  const frames = framesOf(map, rows)
  const settings = flowSettings(task)
  if (!splitsFiles(settings)) return { rounds: roundsOf([], frames, settings), waiting: false }
  const { ids, waiting } = splitFiles(map, task)
  if (waiting || !context) return { rounds: undefined, waiting: true }
  if (!settings.split?.taskId) return { rounds: [], waiting: false }
  return { rounds: roundsOf(through(map, splitConnection(map, task), ids, context, frames).ids, frames, settings), waiting }
}
export const flowPasses = (map: TaskMap, _catalog: Catalog, task: Instance, rows: Frame[]) => {
  const { rounds, waiting } = regionRounds(map, task, rows)
  return { passes: rounds ?? [], waiting: waiting || !rounds }
}

/** The first round of each of `regions` (outermost first), or undefined when one is not known. */
function firstContext(map: TaskMap, regions: Instance[], rows: Frame[]): Context | undefined {
  const context: Context = []
  for (const region of regions) {
    const { rounds } = regionRounds(map, region, rows, context)
    if (!rounds?.length) return undefined
    context.push({ region, round: rounds[0] })
  }
  return context
}

/**
 * A header keyword the split files have: its distinct values, whether it is
 * folded away (one value for all, or a different one for each file), and
 * the keywords that read the same as it on every file.
 */
export type KeywordChoice = { keyword: string; values: string[]; counts: number[]; folded: boolean; same: string[] }
/**
 * Header keywords the split files have. A keyword of the instrument header
 * mapping (Instance.mapping: exposure, filter, ...) stands for the others
 * that read the same on every file, so each meaning is listed once.
 */
export function flowKeywordChoices(map: TaskMap, _catalog: Catalog, task: Instance, rows: Frame[]): KeywordChoice[] {
  const frames = framesOf(map, rows)
  const { ids } = splitFiles(map, task)
  const found: string[] = []
  for (const id of ids)
    for (const keyword of [...Object.keys(frames.get(id)?.labels ?? {}), ...Object.keys(frames.get(id)?.headers ?? {})])
      if (!found.includes(keyword)) found.push(keyword)
  const read = (keyword: string) => ids.map((id) => passValue(frameValue(frames.get(id), keyword)))
  const mapped = Object.values(task.mapping ?? {}).map(String).filter((k) => found.includes(k))
  const standsFor = new Map<string, string>()
  for (const keyword of found) {
    if (mapped.includes(keyword)) continue
    const own = JSON.stringify(read(keyword))
    const same = mapped.find((m) => JSON.stringify(read(m)) === own)
    if (same) standsFor.set(keyword, same)
  }
  const chosen = criteriaOf(task).flatMap((c) => ("keyword" in c ? [c.keyword] : []))
  return [...found.filter((k) => !standsFor.has(k) || chosen.includes(k)), ...chosen.filter((k) => !found.includes(k))].map((keyword) => {
    const each = read(keyword)
    const values = [...new Set(each.filter(Boolean))].sort((a, b) => compareText(a, b))
    return {
      keyword,
      values,
      counts: values.map((v) => each.filter((x) => x === v).length),
      folded: !chosen.includes(keyword) && (values.length <= 1 || (ids.length > 2 && values.length === ids.length)),
      same: [...standsFor].filter(([, m]) => m === keyword).map(([k]) => k),
    }
  })
}

/** The sources a region may split: outside sources connected into it. */
export function splitChoices(map: TaskMap, task: Instance): { taskId: string; outputRole?: string; label: string }[] {
  const choices: { taskId: string; outputRole?: string; label: string }[] = []
  for (const c of map.connections) {
    if (c.source.kind === "files" || !c.source.taskId || isValueRole(c.role)) continue
    if (!insideRegion(map, c.target, task.id) || insideRegion(map, c.source.taskId, task.id)) continue
    const { taskId, outputRole } = c.source
    if (choices.some((s) => s.taskId === taskId && s.outputRole === outputRole)) continue
    const label = map.tasks.find((t) => t.id === taskId)?.label ?? taskId
    choices.push({ taskId, ...(outputRole ? { outputRole } : {}), label: outputRole ? `${label} ${outputRole}` : label })
  }
  return choices
}

/** Names regions had before they were named for beginners. */
const OLD_NAMES = new Set(["foreach", "for", "if", "각각 반복"])
/** Whether the region has a name of its own, not the node's or an old default. */
const isNamed = (spec: Spec | undefined, task: Instance) => {
  const name = task.label.trim()
  return !!name && !OLD_NAMES.has(name) && name !== task.task && name !== spec?.taskName && name !== spec?.title
}
/** The region's name: its task's label, which the inspector and the group editor both edit, or the node's own. */
export function containerName(spec: Spec | undefined, task: Instance): string {
  return isNamed(spec, task) ? task.label.trim() : spec?.taskName || spec?.title || task.label
}
export const containerLabel = (_map: TaskMap, catalog: Catalog, task: Instance): string =>
  containerName(specOf(catalog, task), task)

/** What one criterion says: `EXPTIME`, `5장씩`, `파일마다`, `3번`. */
function criterionText(criterion: Criterion) {
  if ("keyword" in criterion) return criterion.keyword
  if ("expression" in criterion) return criterion.name || criterion.expression
  if ("count" in criterion) return `${criterion.count}장씩`
  if ("each" in criterion) return "파일마다"
  return `${criterion.times}번`
}
/** What the region repeats by, beside its name: `FILTER, EXPTIME마다`, `5장씩`, `EXPTIME > 30만`. */
export function flowStatement(_map: TaskMap, catalog: Catalog, task: Instance): string {
  if (!isFlowSpec(specOf(catalog, task))) return task.label
  const settings = flowSettings(task)
  const parts: string[] = []
  let named: string[] = []
  const flush = () => {
    if (named.length) parts.push(`${named.join(", ")}마다`)
    named = []
  }
  for (const criterion of settings.criteria ?? []) {
    if ("keyword" in criterion || "expression" in criterion) named.push(criterionText(criterion))
    else {
      flush()
      parts.push(criterionText(criterion))
    }
  }
  flush()
  if (settings.condition?.trim()) parts.push(`${settings.condition.trim()}만`)
  return parts.join(" ") || "무엇마다 반복할지 정해 주세요"
}

/**
 * The region heading: a named region shows its name and, beside it, what it
 * repeats by; an unnamed one is titled by what it repeats by (`EXPTIME마다`).
 */
export function flowHeading(map: TaskMap, catalog: Catalog, task: Instance): { title: string; statement?: string } {
  const title = containerLabel(map, catalog, task)
  const statement = flowStatement(map, catalog, task)
  const settings = flowSettings(task)
  const set = !!settings.criteria?.length || !!settings.condition?.trim()
  return isNamed(specOf(catalog, task), task) || !set ? { title, statement } : { title: statement }
}

export type FlowPort = {
  handleId: string
  type: "source" | "target"
  side: "left" | "right"
  /** A diamond value port. */
  value?: boolean
  label?: string
  x: number
  y: number
}
/** A region's value outputs, one per label: the round's value for members' parameters. */
export function flowPorts(map: TaskMap, catalog: Catalog, group: Subflow): { ports: FlowPort[] } {
  const task = containerTask(map, group.id)
  if (!task || !isFlowSpec(specOf(catalog, task))) return { ports: [] }
  const top = FLOW_HEADER + FLOW_ROW / 2
  return {
    ports: flowLabels(task).map((name, index) => ({
      handleId: VALUE_HANDLE + name, type: "source", side: "right", value: true, label: name, x: FLOW_INSET, y: top + FLOW_ROW * index,
    })),
  }
}

/** A collapsed region has no ports of its own; its rows are the connections crossing it. */
export function flowBoundary(map: TaskMap, catalog: Catalog, task: Instance) {
  // The heading keeps name and statement readable beside its controls, within
  // a group card's width range: about 14px a Hangul syllable, 8px other text.
  const { title, statement } = flowHeading(map, catalog, task)
  const heading = [...(statement ? `${title} ${statement}` : title)]
    .reduce((sum, c) => sum + (/[ㄱ-힝]/.test(c) ? 14 : 8), 0)
  const width = Math.min(480, Math.max(320, 232 + heading))
  return { inputs: [], outputs: [], width }
}

/** A new region: its task and an empty group with the same id, right of the canvas. */
export function addContainer(map: TaskMap, catalog: Catalog, spec: Spec, prefs: Preferences, layout: { x: number; y: number; width: number; height: number }[]): TaskMap {
  if (!isFlowSpec(spec)) throw Error("반복 노드가 아닙니다.")
  const task = makeInstance(spec, catalog, prefs)
  task.draft = { ...task.draft, flow: defaultFlowSettings() }
  // With a region open and selected, the new one goes inside it, below what it holds.
  const host = isContainerId(map, map.view.selected) ? map.subflows?.find((g) => g.id === map.view.selected && !g.collapsed) : undefined
  const size = (id: string) => layout[map.tasks.findIndex((t) => t.id === id)] ?? { width: 0, height: 0 }
  let position: { x: number; y: number }
  if (host) {
    const inside = [
      ...map.tasks.filter((t) => t.subflowId === host.id && !isContainerId(map, t.id) && t.position).map((t) => t.position!.y + size(t.id).height),
      ...(map.subflows ?? []).filter((g) => map.tasks.find((t) => t.id === g.id)?.subflowId === host.id).map((g) => g.position.y + g.height),
    ]
    position = { x: host.position.x + 24, y: inside.length ? Math.max(...inside) + 24 : host.position.y + 72 }
  } else {
    const right = Math.max(0, ...layout.map((n) => n.x + n.width), ...(map.subflows ?? []).map((g) => g.position.x + g.width))
    position = { x: layout.length || map.subflows?.length ? right + 112 : 32, y: 32 }
  }
  const group: Subflow = { id: task.id, name: task.label, position, width: 480, height: 240 }
  const next: TaskMap = {
    ...map,
    tasks: [...map.tasks, { ...task, position, ...(host ? { subflowId: host.id } : {}) }],
    subflows: [...(map.subflows ?? []), group],
    view: { ...map.view, selected: task.id },
  }
  return host ? fitGroups(next, host.id, size) : next
}

/**
 * A group's 실행 방식 (subflow-editor): `undefined` runs it once as a plain
 * group. The region task comes and goes with the group's id; members and
 * their connections stay.
 */
export function setGroupRun(map: TaskMap, catalog: Catalog, prefs: Preferences, groupId: string, run: FlowRun | undefined): TaskMap {
  const group = map.subflows?.find((g) => g.id === groupId)
  if (!group || run === flowRun(map, catalog, groupId)) return map
  if (!run) return {
    ...map,
    tasks: map.tasks.filter((t) => t.id !== groupId),
    connections: map.connections.filter((c) => c.source.kind === "files" || c.source.taskId !== groupId),
    view: map.view.selected === groupId ? { ...map.view, selected: "" } : map.view,
  }
  const spec = catalog.tasks.find(isFlowSpec)
  if (!spec) throw Error("이 실행 방식을 찾을 수 없습니다.")
  const task = { ...makeInstance(spec, catalog, prefs), id: groupId, label: group.name, position: group.position }
  return { ...map, tasks: [...map.tasks, { ...task, draft: { ...task.draft, flow: defaultFlowSettings() } }] }
}

/** The names a member's output names may use: each label of the regions around it. */
export const memberVariables = (map: TaskMap, _catalog: Catalog, member: Instance): string[] => sourceLabels(map, member.id)

/** What a label holds, for the output name field: `FILTER 값`, `파일 이름`, `회차`. */
export function variableMeaning(variable: string): string {
  if (variable === EACH_LABEL) return "파일 이름"
  if (variable === TIMES_LABEL || variable === CHUNK_LABEL) return variable
  return `${variable} 값`
}

export type LoopValue = { variable: string; value: string }
/** What each `{label}` in a member's output names reads in the first rounds (giraf/flows.py loop_values). */
export function loopVariables(map: TaskMap, _catalog: Catalog, member: Instance, rows: Frame[]): LoopValue[] | undefined {
  const regions = enclosingRegions(map, member.id)
  if (!regions.length) return undefined
  const context = firstContext(map, regions, rows)
  if (!context) return undefined
  return context.flatMap(({ round }) => Object.entries(round.values).map(([variable, value]) => ({ variable, value: passValue(value) })))
}

/** Output names with each `{label}` replaced; other `{...}` stay as written. */
export function loopOutputNames(draft: Draft, loop: LoopValue[] | undefined): Draft {
  if (!loop?.length) return draft
  const named = (text: string) => loop.reduce((name, { variable, value }) => name.replaceAll(`{${variable}}`, value), text)
  return {
    ...draft,
    outputs: draft.outputs && Object.fromEntries(Object.entries(draft.outputs).map(([k, v]) => [k, named(v)])),
    output: { ...draft.output, name: named(draft.output.name) },
  }
}

export type PassFiles = { name: string; ids: string[] }
/**
 * What one input of a member receives in each round of its innermost region:
 * `same` when every round takes the same files, `passes` with each round's
 * files (`missing` names a round a match leaves empty), `each` for the one
 * file of a region by file, or `unknown` until a source runs.
 */
export type InputPasses =
  | { kind: "same"; ids: string[] }
  | { kind: "passes"; passes: PassFiles[]; missing: string[] }
  | { kind: "each" }
  | { kind: "unknown" }

/** Each input of a region member, by role, as the rounds receive it. */
export function memberPassInputs(map: TaskMap, _catalog: Catalog, member: Instance, rows: Frame[]): Record<string, InputPasses> | undefined {
  const regions = enclosingRegions(map, member.id)
  const inner = regions.at(-1)
  if (!inner) return undefined
  const frames = framesOf(map, rows)
  const outer = firstContext(map, regions.slice(0, -1), rows)
  const { rounds } = outer ? regionRounds(map, inner, rows, outer) : { rounds: undefined }
  const result: Record<string, InputPasses> = {}
  const links = map.connections.filter((c) => c.target === member.id && !isValueRole(c.role))
  for (const role of new Set(links.map((c) => c.role))) {
    if (!outer || !rounds?.length) {
      result[role] = { kind: "unknown" }
      continue
    }
    const each = rounds.map(() => [] as string[])
    const missing = new Set<string>()
    let unknown = false, split = false
    for (const link of links.filter((c) => c.role === role)) {
      const from = link.source.kind !== "files" ? link.source.taskId : undefined
      // Inside the region, a member's files are made round by round.
      if (from && regions.some((r) => insideRegion(map, from, r.id))) { unknown = true; continue }
      const source = resolvedSource(map, link.source)
      if (source.kind === "pending") { unknown = true; continue }
      split ||= receiveMode(map, link, inner).mode === "split"
      rounds.forEach((round, i) => {
        const got = through(map, link, source.ids, [...outer, { region: inner, round }], frames)
        if (got.missing) missing.add(got.missing)
        each[i].push(...got.ids)
      })
    }
    const files = each.map((ids) => [...new Set(ids)])
    if (unknown) result[role] = { kind: "unknown" }
    else if (split && criteriaOf(inner).every((c) => "each" in c) && criteriaOf(inner).length) result[role] = { kind: "each" }
    else if (!split && files.every((ids) => JSON.stringify(ids) === JSON.stringify(files[0]))) result[role] = { kind: "same", ids: files[0] }
    else result[role] = { kind: "passes", passes: rounds.map((round, i) => ({ name: round.name, ids: files[i] })), missing: [...missing] }
  }
  return result
}

/** Does an input take several files (node schema `multiple`)? Unknown inputs are not judged. */
function takesMany(catalog: Catalog, task: Instance, role: string) {
  const spec = specOf(catalog, task)
  return spec?.inputs.find((s) => s.name === role)?.multiple ?? catalog.ccdproc.inputs.find((s) => s.name === role)?.multiple ?? true
}

export const WIDENED_MESSAGE = "묶음에서 한 값만 받던 연결이 전체를 받게 되었습니다."
type LoopIssue = { id: string; severity: "warning"; message: string; nodeId: string; connectionId: string; label: string }

/**
 * Warnings on connections into regions, where the files are known: a round a
 * pairing finds nothing for, a `모두에` source giving several files to an
 * input that takes one, and a connection older documents widened from one
 * value of a split or calibration port (lib/region-migration).
 */
export function loopIssues(map: TaskMap, catalog: Catalog, rows: Frame[]): LoopIssue[] {
  const frames = framesOf(map, rows)
  const issues: LoopIssue[] = []
  const contexts = new Map<string, Context | undefined>()
  for (const c of map.connections) {
    const target = map.tasks.find((t) => t.id === c.target)
    if (!target) continue
    const issue = (kind: string, message: string) =>
      issues.push({ id: `${kind}:${c.id}`, severity: "warning", message, nodeId: target.id, connectionId: c.id, label: target.label })
    if (c.widened) issue("widened", WIDENED_MESSAGE)
    if (isValueRole(c.role) || c.source.kind === "files" || !crossedRegions(map, c).length) continue
    const regions = enclosingRegions(map, target.id)
    const from = c.source.taskId
    // A source inside the regions makes its files round by round.
    if (from && regions.some((r) => insideRegion(map, from, r.id))) continue
    const source = resolvedSource(map, c.source)
    if (source.kind === "pending") continue
    const inner = regions.at(-1)!
    const key = regions.map((r) => r.id).join("/")
    if (!contexts.has(key)) contexts.set(key, firstContext(map, regions.slice(0, -1), rows))
    const outer = contexts.get(key)
    const rounds = outer && regionRounds(map, inner, rows, outer).rounds
    if (!outer || !rounds?.length) continue
    const missing = new Set<string>()
    let many = false
    for (const round of rounds) {
      const got = through(map, c, source.ids, [...outer, { region: inner, round }], frames)
      if (got.missing) missing.add(got.missing)
      many ||= got.ids.length > 1
    }
    for (const round of missing) issue(`loop-match:${round}`, `${round} 회차에 맞는 ${withSubject(c.role)} 없습니다.`)
    if (many && !takesMany(catalog, target, c.role) && crossedRegions(map, c).some((r) => receiveMode(map, c, r).mode === "all")) {
      const name = map.tasks.find((t) => t.id === from)?.label || source.label || c.role
      issue("loop-many", `${withSubject(name)} 여러 장입니다. 칩에서 짝을 고르세요.`)
    }
  }
  return issues
}

/**
 * A member run on its own takes the first round of each region around it:
 * `firstRound` holds the files that round takes from each connection crossing
 * into it, and `roundValues` its values, which the member's value links take
 * (lib/values valueRequest).
 */
export function syncContainerItems(map: TaskMap, catalog: Catalog | null, rows: Frame[]): TaskMap {
  if (!catalog || !map.subflows?.length) return map
  const frames = framesOf(map, rows)
  const contexts = new Map<string, Context | undefined>()
  let changed = false
  const tasks = map.tasks.map((task) => {
    const regions = enclosingRegions(map, task.id)
    const key = regions.map((r) => r.id).join("/")
    if (regions.length && !contexts.has(key)) contexts.set(key, firstContext(map, regions, rows))
    const context = regions.length ? contexts.get(key) : undefined
    const firstRound: Record<string, string[]> = {}
    if (context)
      for (const c of map.connections) {
        if (c.target !== task.id || isValueRole(c.role)) continue
        const from = c.source.kind !== "files" ? c.source.taskId : undefined
        if (from && regions.some((r) => insideRegion(map, from, r.id))) continue
        const source = resolvedSource(map, c.source)
        if (source.kind === "pending") continue
        firstRound[c.id] = through(map, c, source.ids, context, frames).ids
      }
    const next = {
      firstRound: Object.keys(firstRound).length ? firstRound : undefined,
      roundValues: context ? Object.assign({}, ...context.map(({ round }) => round.values)) as Record<string, string> : undefined,
    }
    if (JSON.stringify(next.firstRound) === JSON.stringify(task.firstRound) &&
      JSON.stringify(next.roundValues) === JSON.stringify(task.roundValues)) return task
    changed = true
    return { ...task, ...next }
  })
  return changed ? { ...map, tasks } : map
}

/** Where a value from a region may go: its value outputs reach the tasks inside it only. */
export function checkContainerConnection(map: TaskMap, connection: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }) {
  if (isContainerId(map, connection.target)) throw Error("반복 영역에는 연결점이 없습니다. 안쪽 작업에 바로 연결해 주세요.")
  if (isContainerId(map, connection.source) && !insideRegion(map, connection.target, connection.source))
    throw Error("회차 값은 이 영역 안의 작업에만 연결합니다.")
}

/** Change how a connection receives at a region's border; `undefined` returns it to the default. */
export function setReceiveMode(map: TaskMap, connectionId: string, regionId: string, mode: ReceiveMode | undefined): TaskMap {
  return {
    ...map,
    connections: map.connections.map((c) => {
      if (c.id !== connectionId) return c
      const flow = { ...c.flow }
      if (mode) flow[regionId] = mode
      else delete flow[regionId]
      const { flow: _, ...rest } = c
      void _
      return Object.keys(flow).length ? { ...rest, flow } : rest
    }),
  }
}

type FlowRequest = {
  id: string
  label: string
  members: string[]
  criteria: Criterion[]
  split?: FlowSplit
  splitFiles?: string[]
  condition: string
}
/** Regions for a workflow run (giraf/flows.py); a split source outside `inRun` gives the files it holds now. */
export function flowRequests(map: TaskMap, catalog: Catalog, inRun: Set<string>): FlowRequest[] {
  return map.tasks.flatMap((task) => {
    if (!flowRun(map, catalog, task.id)) return []
    const s = flowSettings(task)
    const split = s.split?.taskId ? s.split : undefined
    const outside = split && !inRun.has(split.taskId) ? splitFiles(map, task).ids : undefined
    return [{
      id: task.id,
      label: containerLabel(map, catalog, task),
      members: containerMembers(map, task.id).map((t) => t.id),
      criteria: s.criteria ?? [],
      ...(split ? { split } : {}),
      ...(outside ? { splitFiles: outside } : {}),
      condition: s.condition ?? "",
    }]
  })
}

/** Progress for a running region: `2/4` shown, `4회 중 2번째` read aloud. */
export function flowProgress(run: FlowRun | undefined, progress: { index: number; total: number } | undefined) {
  if (!run || !progress) return undefined
  const { index, total } = progress
  return { text: `${index}/${total}`, label: `${total}회 중 ${index}번째` }
}
