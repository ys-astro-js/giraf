/**
 * foreach, for and if containers (docs/node-structure-brief.md §3.7).
 *
 * A container is a GIRAF node (node schema `giraf.foreach`, `giraf.for`,
 * `giraf.if`, flow component of the same name) drawn as a group: the task
 * instance and its subflow share one id, members are the tasks in that group,
 * and its settings live in `draft.flow`. The server expands it
 * (giraf/workflow.py, giraf/flows.py).
 *
 * Ports, all addressed by the container id:
 *   its schema input (`items`, `input`)  outer left, the list or routed files
 *   `p:<name>`                           an `if` condition value (header diamond)
 *   `output:item`                        foreach: the current item, inner left
 *   `value:<variable>`                   for: the current number, inner left
 *   `output:then`, `output:else`         if: the true and false lanes
 *   `result`                             member outputs to collect, inner right
 *   `output:results`                     every iteration's results, outer right
 *
 * A 각각 반복 runs once per file, or once per combination of the values the
 * header keywords chosen on it (`draft.flow.keywords`) take in its files. Files
 * reaching a member from outside the loop go to the passes they match
 * (matchPass); the server does the same at run time (giraf/flows.py).
 */
import { makeInstance, type Instance, type Source, type Subflow, type TaskMap } from "./task-map/model"
import { resolvedSource } from "./task-map/runs"
import { COLLECT_PORT, RESULTS_PORT, isContainerId } from "./flow-graph"
import { customPortHandle, partitionValue, partitionValues, portIdForRole } from "./output-ports"
import { primaryOutputRole } from "./calibration-ports"
import { expressionNames, isValueRole, PARAM_HANDLE, VALUE_HANDLE } from "./values"
import { withSubject } from "./korean"
import type { Catalog, Draft, Frame, Preferences, Spec } from "./workbench"

export { COLLECT_PORT, RESULTS_PORT, isContainerId }
export const FLOW_RUNS = ["foreach", "for", "if"] as const
export type FlowRun = (typeof FLOW_RUNS)[number]
export type FlowSettings = {
  variable?: string
  /** 각각 반복: the header keywords it runs by, once per combination of their values. */
  keywords?: string[]
  start?: string
  end?: string
  step?: string
  condition?: string
}
export const ITEM_PORT = "item"
export const THEN_PORT = "then"
export const ELSE_PORT = "else"
/** The group heading's height (.subflow-heading); the body starts below it. */
export const FLOW_HEADER = 56
export const FLOW_ROW = 32
/** Inner ports sit this far inside the container's border. */
export const FLOW_INSET = 20
const INNER: Record<FlowRun, string[]> = { foreach: [ITEM_PORT], for: [], if: [THEN_PORT, ELSE_PORT] }

export const isFlowSpec = (spec: Spec | undefined): spec is Spec & { run: FlowRun } =>
  !!spec?.run && (FLOW_RUNS as readonly string[]).includes(spec.run)
const specOf = (catalog: Catalog, task: Instance | undefined) => catalog.tasks.find((s) => s.name === task?.task)

/** The container task of a group, if the group is a container. */
export const containerTask = (map: TaskMap, id: string | undefined): Instance | undefined =>
  isContainerId(map, id) ? map.tasks.find((t) => t.id === id) : undefined
export function flowRun(map: TaskMap, catalog: Catalog, id: string | undefined): FlowRun | undefined {
  const spec = specOf(catalog, containerTask(map, id))
  return isFlowSpec(spec) ? spec.run : undefined
}
export const containerMembers = (map: TaskMap, id: string) => map.tasks.filter((t) => t.subflowId === id)
export const flowSettings = (task: Instance | undefined): FlowSettings => task?.draft.flow ?? {}
/** The header keywords a 각각 반복 runs by; none runs it once per file. */
export const flowKeywords = (task: Instance | undefined): string[] => flowSettings(task).keywords ?? []

export function defaultFlowSettings(run: FlowRun): FlowSettings {
  if (run === "foreach") return { variable: FILE_VARIABLE, keywords: [] }
  if (run === "for") return { variable: NUMBER_VARIABLE, start: "1", end: "3", step: "1" }
  return { condition: "" }
}

const FILE_VARIABLE = "파일"
const NUMBER_VARIABLE = "숫자"
/**
 * The name output names use for the iteration (`{FILTER}`, `{파일}`, `{숫자}`):
 * set by the container, never typed. A 각각 반복 by several keywords keeps the
 * one it has while that keyword stays chosen; each keyword is a name too.
 */
export function flowVariable(map: TaskMap, catalog: Catalog, task: Instance): string | undefined {
  const run = flowRun(map, catalog, task.id)
  if (run === "for") return NUMBER_VARIABLE
  if (run !== "foreach") return undefined
  const keywords = flowKeywords(task)
  const current = flowSettings(task).variable
  return current && keywords.includes(current) ? current : (keywords[0] ?? FILE_VARIABLE)
}
/** What the variable holds, for the output name field: `FILTER 값`, `파일 이름`, `숫자`. */
export function variableMeaning(variable: string): string {
  if (variable === FILE_VARIABLE) return "파일 이름"
  if (variable === NUMBER_VARIABLE) return "숫자"
  return `${variable} 값`
}

const number = (text: string | undefined) => {
  if (text === undefined || text.trim() === "") return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

/**
 * A pass's value as people read it and output names take it (giraf/values.py
 * pass_value): a whole number without decimals (15.0 is 15), otherwise the
 * trimmed text (30.66011, B). Passes still group and match by the header's text.
 */
export function passValue(text: string): string {
  const value = number(text)
  return value !== undefined && Number.isInteger(value) ? String(value) : text.trim()
}

/** The connections that feed the container's list (foreach, any number) or routed input (if). */
export function flowInputs(map: TaskMap, catalog: Catalog, task: Instance) {
  const role = specOf(catalog, task)?.inputs[0]?.name
  return role ? map.connections.filter((c) => c.target === task.id && c.role === role) : []
}
export const flowInput = (map: TaskMap, catalog: Catalog, task: Instance) => flowInputs(map, catalog, task)[0]

/**
 * Before keywords were chosen on the loop: one stored as `partition`, or the
 * keyword of the split port its list came from (FILTER: B, V).
 */
function legacyKeyword(map: TaskMap, catalog: Catalog, task: Instance): string | undefined {
  const stored = (flowSettings(task) as { partition?: unknown }).partition
  if (typeof stored === "string" && stored) return stored
  const from = flowInput(map, catalog, task)?.source
  if (!from || from.kind === "files" || from.partition) return undefined
  const source = map.tasks.find((t) => t.id === from.taskId)
  if (!source) return undefined
  const primary = primaryOutputRole(specOf(catalog, source), source)
  const port = source.outputPorts?.find((p) => p.partition &&
    (customPortHandle(p.id) === from.port || p.id === portIdForRole(from.outputRole, primary)))
  return port?.partition?.keyword
}

/** Older 각각 반복 nodes take their keyword onto the loop; a split port no longer decides passes. */
export function migrateFlowKeywords(map: TaskMap, catalog: Catalog): TaskMap {
  let changed = false
  const tasks = map.tasks.map((task) => {
    if (flowRun(map, catalog, task.id) !== "foreach" || task.draft.flow?.keywords) return task
    const keyword = legacyKeyword(map, catalog, task)
    const flow: FlowSettings & { partition?: unknown } = { ...task.draft.flow, keywords: keyword ? [keyword] : [] }
    delete flow.partition
    changed = true
    return { ...task, draft: { ...task.draft, flow } }
  })
  return changed ? { ...map, tasks } : map
}

const framesOf = (map: TaskMap, rows: Frame[]) =>
  new Map([...rows, ...map.runs.flatMap((r) => r.products)].map((f) => [f.id, f]))

/**
 * The files a container's input holds now: every link's, each file once.
 * `waiting` while a link's source has not run, so the files are not all known.
 */
export function flowFiles(map: TaskMap, catalog: Catalog, task: Instance): { ids: string[]; waiting: boolean } {
  let waiting = false
  const ids = flowInputs(map, catalog, task).flatMap((link) => {
    const source = resolvedSource(map, link.source)
    if (source.kind !== "pending") return source.ids
    waiting = true
    return []
  })
  return { ids: [...new Set(ids)], waiting }
}

export type KeywordChoice = { keyword: string; values: string[] }
/** Header keywords the loop's files have, each with its distinct values; chosen ones stay listed. */
export function flowKeywordChoices(map: TaskMap, catalog: Catalog, task: Instance, rows: Frame[]): KeywordChoice[] {
  const frames = framesOf(map, rows)
  const { ids } = flowFiles(map, catalog, task)
  const found: string[] = []
  for (const id of ids)
    for (const keyword of Object.keys(frames.get(id)?.headers ?? {}))
      if (!found.includes(keyword)) found.push(keyword)
  const keywords = [...found, ...flowKeywords(task).filter((k) => !found.includes(k))]
  return keywords.map((keyword) => ({
    keyword,
    values: [...new Set(partitionValues(ids, [...frames.values()], keyword).filter(Boolean).map(passValue))],
  }))
}

/** One run of a 각각 반복: `B 30` and its files, or one file by its name; `values` are the headers' text. */
export type FlowPass = { name: string; values: Record<string, string>; ids: string[] }
const compareText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
/** Passes by the values of `keywords`, sorted naturally (giraf/flows.py iterations); none, one per file. */
export function groupPasses(ids: string[], frames: Map<string, Frame>, keywords: string[]): FlowPass[] {
  if (!keywords.length)
    return ids.map((id) => {
      const frame = frames.get(id)
      return { name: stem(frame?.label || frame?.name || id), values: {}, ids: [id] }
    })
  const groups = new Map<string, FlowPass>()
  for (const id of ids) {
    const values = keywords.map((k) => partitionValue(frames.get(id), k))
    const key = JSON.stringify(values)
    const pass = groups.get(key) ?? {
      name: values.map((v) => (v ? passValue(v) : "없음")).join(" "),
      values: Object.fromEntries(keywords.map((k, i) => [k, values[i]])),
      ids: [],
    }
    pass.ids.push(id)
    groups.set(key, pass)
  }
  return [...groups.values()].sort((a, b) => {
    for (const k of keywords) {
      const order = compareText(a.values[k], b.values[k])
      if (order) return order
    }
    return 0
  })
}
/** The passes a 각각 반복 makes of the files known now. */
export function flowPasses(map: TaskMap, catalog: Catalog, task: Instance, rows: Frame[]): { passes: FlowPass[]; waiting: boolean } {
  const { ids, waiting } = flowFiles(map, catalog, task)
  return { passes: groupPasses(ids, framesOf(map, rows), flowKeywords(task)), waiting }
}

/** A pass's files in a few words: `Zero.fits` for one file, `5장` for images, `파일 3개` otherwise. */
export function passFilesText(ids: string[], frames: Map<string, Frame>, nameOne = true): string {
  if (nameOne && ids.length === 1) {
    const frame = frames.get(ids[0])
    return frame?.label || frame?.name || ids[0]
  }
  return ids.every((id) => (frames.get(id)?.asset ?? "image") === "image") ? `${ids.length}장` : `파일 ${ids.length}개`
}
export const loopFrames = framesOf

/** Header values as a loop compares them: as numbers when both read as one (15 is 15.0), otherwise as trimmed text. */
function sameValue(a: string, b: string): boolean {
  const [x, y] = [number(a), number(b)]
  return x !== undefined && y !== undefined ? x === y : a.trim() === b.trim()
}

/**
 * The files a pass takes from a connection from outside its loop
 * (giraf/flows.py match_pass). A loop keyword matches the connection when its
 * files differ in it and at least one has a value one of the loop's `passes`
 * has; the pass keeps the files equal to its values in every matching
 * keyword. With none (one file, files that agree, text files without the
 * header, values no pass has) the connection reaches every pass as it is.
 */
export function matchPass(
  ids: string[], frames: Map<string, Frame>, values: Record<string, string>, passes: Record<string, string>[],
): { ids: string[]; matched: boolean } {
  const used = (k: string) => {
    const found = ids.map((id) => partitionValue(frames.get(id), k))
    return found.some((v) => !sameValue(v, found[0])) && found.some((v) => passes.some((other) => sameValue(v, other[k] ?? "")))
  }
  const keys = Object.keys(values).filter(used)
  if (!keys.length) return { ids, matched: false }
  return { ids: ids.filter((id) => keys.every((k) => sameValue(partitionValue(frames.get(id), k), values[k]))), matched: true }
}

/** Names containers had before they were named for beginners. */
const OLD_NAMES = new Set<string>(FLOW_RUNS)
/** The container's name: its task's label, which the inspector and the group editor both edit, or the node's own (각각 반복). */
export function containerName(spec: Spec | undefined, task: Instance): string {
  const name = task.label.trim()
  return name && !OLD_NAMES.has(name) && name !== task.task ? name : spec?.taskName || spec?.title || task.label
}
export const containerLabel = (_map: TaskMap, catalog: Catalog, task: Instance): string =>
  containerName(specOf(catalog, task), task)

/** What the container does, beside its name: `M67 FILTER별로`, `1부터 3까지 1씩`, `EXPTIME > 30`. */
export function flowStatement(map: TaskMap, catalog: Catalog, task: Instance): string {
  const spec = specOf(catalog, task)
  const s = flowSettings(task)
  if (!isFlowSpec(spec)) return task.label
  if (spec.run === "foreach") {
    const names = flowSourceLabels(map, catalog, task)
    const name = names.length ? names.join(", ") : "연결한 파일"
    const keywords = flowKeywords(task)
    return keywords.length ? `${name} ${keywords.join(", ")}별로` : names.length ? `${name} 파일마다` : "연결한 파일마다"
  }
  if (spec.run === "for") {
    const [start, end, step] = [s.start, s.end, s.step].map((v) => v?.trim())
    return start && end ? `${start}부터 ${end}까지 ${step || "1"}씩` : "범위를 정해 주세요"
  }
  return s.condition?.trim() || "조건을 정해 주세요"
}

/** What feeds the container's input: each source node's name, a split port's member with its value. */
function flowSourceLabels(map: TaskMap, catalog: Catalog, task: Instance): string[] {
  return [...new Set(flowInputs(map, catalog, task).flatMap((link) => {
    const origin = link.source
    const from = origin.kind !== "files" ? map.tasks.find((t) => t.id === origin.taskId) : undefined
    return from ? [`${from.label}${origin.partition ? " " + origin.partition.value : ""}`] : []
  }))]
}

const ITEM_LABEL = "이번 파일"
/** What a member's input shows for a container's inner port: 이번 파일, 참 or 거짓. */
export function innerPortLabel(map: TaskMap, source: Source): string | undefined {
  if (source.kind === "files" || !isContainerId(map, source.taskId)) return undefined
  if (source.outputRole === ITEM_PORT) return ITEM_LABEL
  if (source.outputRole === THEN_PORT) return "참"
  if (source.outputRole === ELSE_PORT) return "거짓"
  return undefined
}

/** The names an if condition reads; a connected name takes that value, others read file headers. */
export const conditionNames = (task: Instance) => expressionNames(flowSettings(task).condition ?? "")

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
/** Ports of an expanded container in its own coordinates. */
export function flowPorts(map: TaskMap, catalog: Catalog, group: Subflow): { ports: FlowPort[] } {
  const task = containerTask(map, group.id)
  const spec = specOf(catalog, task)
  if (!task || !isFlowSpec(spec)) return { ports: [] }
  const top = FLOW_HEADER + FLOW_ROW / 2
  const ports: FlowPort[] = []
  const input = spec.inputs[0]
  if (input) ports.push({ handleId: input.name, type: "target", side: "left", label: input.label, x: 0, y: top })
  const names = spec.run === "if" ? conditionNames(task) : []
  // Condition values arrive on the heading, spread around its middle.
  names.forEach((name, index) => ports.push({
    handleId: PARAM_HANDLE + name, type: "target", side: "left", value: true, label: name,
    x: 0, y: FLOW_HEADER / 2 + (index - (names.length - 1) / 2) * Math.min(14, 40 / Math.max(names.length, 1)),
  }))
  const s = flowSettings(task)
  if (spec.run === "for" && s.variable)
    ports.push({ handleId: VALUE_HANDLE + s.variable, type: "source", side: "right", value: true, label: "이번 숫자", x: FLOW_INSET, y: top })
  // An if body is two halves, 참 above 거짓.
  const half = FLOW_HEADER + Math.max(FLOW_ROW * 2, (group.height - FLOW_HEADER) / 2)
  for (const port of INNER[spec.run])
    ports.push({
      handleId: "output:" + port, type: "source", side: "right",
      label: port === ITEM_PORT ? ITEM_LABEL : port === THEN_PORT ? "참" : "거짓",
      x: FLOW_INSET, y: port === ELSE_PORT ? half + FLOW_ROW / 2 : top,
    })
  ports.push({ handleId: COLLECT_PORT, type: "target", side: "left", label: "결과", x: group.width - FLOW_INSET, y: top })
  ports.push({ handleId: "output:" + RESULTS_PORT, type: "source", side: "right", x: group.width, y: top })
  return { ports }
}

/** Rows of a collapsed container that stand for its own boundary ports. */
export function flowBoundary(map: TaskMap, catalog: Catalog, task: Instance) {
  const spec = specOf(catalog, task)
  if (!isFlowSpec(spec)) return { inputs: [], outputs: [] }
  const from = flowSourceLabels(map, catalog, task).join(", ")
  const inputs = [
    ...spec.inputs.map((slot) => ({ handleId: slot.name, member: task.id, port: slot.name, label: slot.label, summary: from, value: false })),
    ...(spec.run === "if" ? conditionNames(task) : []).map((name) => ({
      handleId: PARAM_HANDLE + name, member: task.id, port: PARAM_HANDLE + name, label: name, summary: "", value: true })),
  ]
  const outputs = [{ handleId: "output:" + RESULTS_PORT, member: task.id, port: "output:" + RESULTS_PORT, label: "결과", summary: "", value: false }]
  // The heading keeps name and statement readable beside its controls, within
  // a group card's width range: about 14px a Hangul syllable, 8px other text.
  const heading = [...`${containerLabel(map, catalog, task)} ${flowStatement(map, catalog, task)}`]
    .reduce((sum, c) => sum + (/[\u3131-\uD79D]/.test(c) ? 14 : 8), 0)
  const width = Math.min(480, Math.max(320, 232 + heading))
  return { inputs, outputs, width }
}

/** A new container: its task and an empty group with the same id, right of the canvas. */
export function addContainer(map: TaskMap, catalog: Catalog, spec: Spec, prefs: Preferences, layout: { x: number; y: number; width: number; height: number }[]): TaskMap {
  if (!isFlowSpec(spec)) throw Error("반복이나 조건 분기 노드가 아닙니다.")
  const task = makeInstance(spec, catalog, prefs)
  task.draft = { ...task.draft, flow: defaultFlowSettings(spec.run) }
  const right = Math.max(0, ...layout.map((n) => n.x + n.width), ...(map.subflows ?? []).map((g) => g.position.x + g.width))
  const position = { x: layout.length || map.subflows?.length ? right + 112 : 32, y: 32 }
  const group: Subflow = { id: task.id, name: task.label, position, width: 480, height: spec.run === "if" ? 360 : 240 }
  return {
    ...map,
    tasks: [...map.tasks, { ...task, position }],
    subflows: [...(map.subflows ?? []), group],
    view: { ...map.view, selected: task.id },
  }
}

/**
 * A group's 실행 방식 (subflow-editor): `undefined` runs it once as a plain group.
 * The container task comes and goes with the group's id; members stay, and
 * connections keep only the ports the new kind still has.
 */
export function setGroupRun(map: TaskMap, catalog: Catalog, prefs: Preferences, groupId: string, run: FlowRun | undefined): TaskMap {
  const group = map.subflows?.find((g) => g.id === groupId)
  if (!group || run === flowRun(map, catalog, groupId)) return map
  const own = (c: TaskMap["connections"][number]) =>
    c.target === groupId || (c.source.kind !== "files" && c.source.taskId === groupId)
  if (!run) return {
    ...map,
    tasks: map.tasks.filter((t) => t.id !== groupId),
    connections: map.connections.filter((c) => !own(c)),
    view: map.view.selected === groupId ? { ...map.view, selected: "" } : map.view,
  }
  const spec = catalog.tasks.find((s) => isFlowSpec(s) && s.run === run)
  if (!spec) throw Error("이 실행 방식을 찾을 수 없습니다.")
  const current = containerTask(map, groupId)
  const made = current ?? { ...makeInstance(spec, catalog, prefs), id: groupId, label: group.name, position: group.position }
  // The variable keeps its old name so member output names follow it (syncFlowVariables).
  const variable = flowSettings(current).variable
  const keywords = flowSettings(current).keywords
  const flow = {
    ...defaultFlowSettings(run),
    ...(run !== "if" && variable ? { variable } : {}),
    ...(run === "foreach" && keywords ? { keywords } : {}),
  }
  const task = { ...made, task: spec.name, draft: { ...made.draft, flow } }
  // An if keeps room for both lanes.
  const height = run === "if" ? Math.max(group.height, FLOW_HEADER + FLOW_ROW * 4) : group.height
  const next = {
    ...map,
    tasks: current ? map.tasks.map((t) => (t.id === groupId ? task : t)) : [...map.tasks, task],
    subflows: map.subflows!.map((g) => (g.id === groupId ? { ...g, height } : g)),
  }
  const handles = new Set(flowPorts(next, catalog, next.subflows.find((g) => g.id === groupId)!).ports.map((p) => p.type + p.handleId))
  const kept = (c: TaskMap["connections"][number]) => {
    if (c.target === groupId && !handles.has("target" + c.role)) return false
    if (c.source.kind === "files" || c.source.taskId !== groupId) return true
    const role = c.source.outputRole ?? ""
    return handles.has("source" + (role.startsWith(VALUE_HANDLE) ? role : "output:" + role))
  }
  return { ...next, connections: next.connections.filter(kept) }
}

/** The files the container hands its members first: one file, or the first pass's. */
export function firstItem(map: TaskMap, catalog: Catalog, task: Instance, rows: Frame[]): string[] | undefined {
  return flowPasses(map, catalog, task, rows).passes[0]?.ids
}

const formatNumber = (value: number) => String(Number.isInteger(value) ? value : Number(value.toFixed(10)))
function stem(label: string) {
  const base = label.split("/").at(-1) ?? ""
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

/** The names a member's output names may use, inside a 각각 반복 (each keyword, or 파일) or 반복 (숫자). */
export function memberVariables(map: TaskMap, catalog: Catalog, member: Instance): string[] {
  const run = flowRun(map, catalog, member.subflowId)
  if (run !== "foreach" && run !== "for") return []
  const container = containerTask(map, member.subflowId)
  const keywords = run === "foreach" ? flowKeywords(container) : []
  if (keywords.length) return keywords
  const variable = flowSettings(container).variable
  return variable ? [variable] : []
}

export type LoopValue = { variable: string; value: string }
/**
 * What each `{variable}` in a member's output names reads in the container's
 * first iteration (giraf/flows.py loop_values): the `for` start, each
 * keyword's first value, or the first file's stem.
 */
export function loopVariables(map: TaskMap, catalog: Catalog, member: Instance, rows: Frame[]): LoopValue[] | undefined {
  const container = containerTask(map, member.subflowId)
  const run = flowRun(map, catalog, member.subflowId)
  const variables = memberVariables(map, catalog, member)
  if (!container || !variables.length) return undefined
  if (run === "for") {
    const start = number(flowSettings(container).start)
    return start === undefined ? undefined : [{ variable: variables[0], value: formatNumber(start) }]
  }
  const first = flowPasses(map, catalog, container, rows).passes[0]
  if (!first) return undefined
  if (flowKeywords(container).length) return variables.map((variable) => ({ variable, value: passValue(first.values[variable] ?? "") }))
  return [{ variable: variables[0], value: first.name }]
}

/** Output names with each `{variable}` replaced; other `{...}` stay as written. */
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
 * What one input of a member receives in each pass: `same` when every pass
 * takes the same files, `passes` with each pass's files (`missing` names a
 * pass a matched connection gives nothing), `each` for one file a pass
 * from a loop by file, or `unknown` until a source runs.
 */
export type InputPasses =
  | { kind: "same"; ids: string[] }
  | { kind: "passes"; passes: PassFiles[]; missing: string[] }
  | { kind: "each" }
  | { kind: "unknown" }

/** Each input of a 각각 반복's member, by role, as the passes receive it. */
export function memberPassInputs(map: TaskMap, catalog: Catalog, member: Instance, rows: Frame[]): Record<string, InputPasses> | undefined {
  const container = containerTask(map, member.subflowId)
  if (!container || flowRun(map, catalog, container.id) !== "foreach") return undefined
  const frames = framesOf(map, rows)
  const { passes, waiting } = flowPasses(map, catalog, container, rows)
  const keywords = flowKeywords(container)
  const members = new Set(containerMembers(map, container.id).map((t) => t.id))
  const result: Record<string, InputPasses> = {}
  const links = map.connections.filter((c) => c.target === member.id && !isValueRole(c.role))
  for (const role of new Set(links.map((c) => c.role))) {
    const each = passes.map(() => [] as string[])
    const missing = new Set<string>()
    let unknown = false, item = false
    for (const link of links.filter((c) => c.role === role)) {
      const from = link.source.kind !== "files" ? link.source.taskId : undefined
      if (from === container.id) {
        item = true
        if (waiting && !passes.length) unknown = true
        passes.forEach((pass, i) => each[i].push(...pass.ids))
        continue
      }
      // Inside the loop, a member's files are made pass by pass.
      if (from && members.has(from)) { unknown = true; continue }
      const source = resolvedSource(map, link.source)
      if (source.kind === "pending") { unknown = true; continue }
      passes.forEach((pass, i) => {
        const matched = matchPass(source.ids, frames, pass.values, passes.map((p) => p.values))
        if (matched.matched && !matched.ids.length) missing.add(pass.name)
        each[i].push(...matched.ids)
      })
    }
    if (unknown || !passes.length) result[role] = { kind: "unknown" }
    else if (item && !keywords.length) result[role] = { kind: "each" }
    else {
      const files = each.map((ids) => [...new Set(ids)])
      const same = !item && files.every((ids) => JSON.stringify(ids) === JSON.stringify(files[0]))
      result[role] = same
        ? { kind: "same", ids: files[0] }
        : { kind: "passes", passes: passes.map((pass, i) => ({ name: pass.name, ids: files[i] })), missing: [...missing] }
    }
  }
  return result
}

/** Warnings for passes an outside connection has no matching file for, where the files are known. */
export function loopIssues(map: TaskMap, catalog: Catalog, rows: Frame[]) {
  return map.tasks.flatMap((member) => {
    const container = containerTask(map, member.subflowId)
    if (!container || !flowKeywords(container).length) return []
    return Object.entries(memberPassInputs(map, catalog, member, rows) ?? {}).flatMap(([role, input]) =>
      input.kind === "passes"
        ? input.missing.map((pass) => ({
            id: `loop-match:${member.id}:${role}:${pass}`,
            severity: "warning" as const,
            message: `${pass} 회차에 맞는 ${withSubject(role)} 없습니다.`,
            nodeId: member.id,
            label: member.label,
          }))
        : [])
  })
}

/**
 * A member run on its own takes the container's first item (foreach); `passed`
 * holds it like a pass output, so resolvedSource finds it, and `firstPass` holds
 * the files the first pass takes from each matched outside connection and
 * `firstPassValues` its values, which the member's value links take
 * (lib/values valueRequest). Lanes of an if and a for variable's first number
 * are settled at run time or by the value request.
 */
export function syncContainerItems(map: TaskMap, catalog: Catalog | null, rows: Frame[]): TaskMap {
  if (!catalog || !map.subflows?.length) return map
  map = syncFlowVariables(migrateFlowKeywords(map, catalog), catalog)
  const frames = framesOf(map, rows)
  const known = new Map<string, FlowPass[]>()
  const passesOf = (container: Instance) => {
    if (!known.has(container.id)) known.set(container.id, flowPasses(map, catalog, container, rows).passes)
    return known.get(container.id)!
  }
  const firstOf = (container: Instance) => passesOf(container)[0]
  let changed = false
  const tasks = map.tasks.map((task) => {
    if (flowRun(map, catalog, task.id) === "foreach") {
      const ids = firstOf(task)?.ids
      const passed = ids ? { [ITEM_PORT]: ids } : undefined
      if (JSON.stringify(passed) === JSON.stringify(task.passed)) return task
      changed = true
      return { ...task, passed }
    }
    const container = containerTask(map, task.subflowId)
    const first = container && flowRun(map, catalog, container.id) === "foreach" ? firstOf(container) : undefined
    const matched: Record<string, string[]> = {}
    if (first && flowKeywords(container).length)
      for (const c of map.connections) {
        if (c.target !== task.id || isValueRole(c.role)) continue
        const origin = c.source
        const from = origin.kind !== "files" ? map.tasks.find((t) => t.id === origin.taskId) : undefined
        if (from && (from.id === container!.id || from.subflowId === container!.id)) continue
        const source = resolvedSource(map, c.source)
        if (source.kind === "pending") continue
        const match = matchPass(source.ids, frames, first.values, passesOf(container!).map((p) => p.values))
        if (match.matched) matched[c.id] = match.ids
      }
    const firstPass = Object.keys(matched).length ? matched : undefined
    const firstPassValues = first && flowKeywords(container).length ? first.values : undefined
    if (JSON.stringify(firstPass) === JSON.stringify(task.firstPass) &&
      JSON.stringify(firstPassValues) === JSON.stringify(task.firstPassValues)) return task
    changed = true
    return { ...task, firstPass, firstPassValues }
  })
  return changed ? { ...map, tasks } : map
}

/**
 * Keep each container's variable what it iterates (`FILTER`, `파일`, `숫자`);
 * member output names and value connections follow a renamed one.
 */
function syncFlowVariables(map: TaskMap, catalog: Catalog): TaskMap {
  const renamed = new Map<string, { from?: string; to: string }>()
  for (const task of map.tasks) {
    const to = flowVariable(map, catalog, task)
    const from = flowSettings(task).variable
    if (to && to !== from) renamed.set(task.id, { from, to })
  }
  if (!renamed.size) return map
  const swap = (text: string, from: string | undefined, to: string) => from ? text.replaceAll(`{${from}}`, `{${to}}`) : text
  const tasks = map.tasks.map((task) => {
    const own = renamed.get(task.id)
    if (own) return { ...task, draft: { ...task.draft, flow: { ...task.draft.flow, variable: own.to } } }
    const outer = task.subflowId ? renamed.get(task.subflowId) : undefined
    if (!outer?.from) return task
    const d = task.draft
    return {
      ...task,
      draft: {
        ...d,
        outputs: d.outputs && Object.fromEntries(Object.entries(d.outputs).map(([k, v]) => [k, swap(v, outer.from, outer.to)])),
        output: { ...d.output, name: swap(d.output.name, outer.from, outer.to) },
      },
    }
  })
  const connections = map.connections.map((c) => {
    const change = c.source.kind !== "files" && c.source.taskId ? renamed.get(c.source.taskId) : undefined
    if (!change?.from || c.source.kind === "files" || c.source.outputRole !== VALUE_HANDLE + change.from) return c
    return { ...c, source: { ...c.source, outputRole: VALUE_HANDLE + change.to } }
  })
  return { ...map, tasks, connections }
}

/** Where a connection to or from a container may go: inner ports reach members only. */
export function checkContainerConnection(map: TaskMap, connection: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }) {
  const source = map.tasks.find((t) => t.id === connection.source)
  const target = map.tasks.find((t) => t.id === connection.target)
  if (isContainerId(map, connection.source)) {
    const inner = connection.sourceHandle !== "output:" + RESULTS_PORT
    if (inner && target?.subflowId !== connection.source)
      throw Error("안쪽 연결점은 이 안의 작업에만 연결합니다.")
    if (!inner && target?.subflowId === connection.source)
      throw Error("결과는 바깥 작업으로 내보냅니다.")
    if (connection.target === connection.source) throw Error("자기 자신에게는 연결할 수 없습니다.")
  }
  if (isContainerId(map, connection.target)) {
    const collect = connection.targetHandle === COLLECT_PORT
    if (collect && source?.subflowId !== connection.target)
      throw Error("모을 결과는 안쪽 작업에서 연결합니다.")
    if (!collect && source?.subflowId === connection.target)
      throw Error("입력은 바깥에서 연결합니다.")
  }
}

/** Collect a member's output: any number of members feed `result`. */
export function connectCollect(map: TaskMap, containerId: string, source: Source): TaskMap {
  if (source.kind === "files") throw Error("모을 결과는 작업의 출력에서 연결합니다.")
  const same = (c: TaskMap["connections"][number]) => c.target === containerId && c.role === COLLECT_PORT &&
    c.source.kind !== "files" && c.source.taskId === source.taskId && JSON.stringify(c.source) === JSON.stringify(source)
  if (map.connections.some(same)) return map
  return { ...map, connections: [...map.connections, { id: crypto.randomUUID(), target: containerId, role: COLLECT_PORT, source }] }
}

type FlowRequest = {
  id: string
  label: string
  run: FlowRun
  members: string[]
  variable: string
  files: string[]
  keywords?: string[]
  start?: number
  end?: number
  step?: number
  condition: string
  connected: boolean
}
/** Containers for a workflow run (giraf/flows.py); `inRun` tasks give their files at run time. */
export function flowRequests(map: TaskMap, catalog: Catalog, inRun: Set<string>): FlowRequest[] {
  return map.tasks.flatMap((task) => {
    const run = flowRun(map, catalog, task.id)
    if (!run) return []
    const s = flowSettings(task)
    const links = run === "foreach" ? flowInputs(map, catalog, task) : [flowInput(map, catalog, task)].filter((c) => !!c)
    // Sources outside this run give the files they hold now; the rest arrive as links.
    const files = [...new Set(links.flatMap((link) => {
      const sourceId = link.source.kind !== "files" ? link.source.taskId : undefined
      if (sourceId && inRun.has(sourceId)) return []
      const resolved = resolvedSource(map, link.source)
      return resolved.kind === "pending" ? [] : resolved.ids
    }))]
    const range = run === "for" ? { start: number(s.start), end: number(s.end), step: number(s.step) } : {}
    return [{
      id: task.id,
      label: containerLabel(map, catalog, task),
      run,
      members: containerMembers(map, task.id).map((t) => t.id),
      variable: s.variable ?? "",
      files,
      ...(run === "foreach" ? { keywords: flowKeywords(task) } : {}),
      ...Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined)),
      condition: s.condition ?? "",
      connected: links.length > 0,
    }]
  })
}

/** Progress for a running container: `9/24` shown, `24개 중 9번째` read aloud. */
export function flowProgress(run: FlowRun | undefined, progress: { index: number; total: number } | undefined) {
  if (!run || !progress || run === "if") return undefined
  const { index, total } = progress
  return { text: `${index}/${total}`, label: run === "for" ? `${total}회 중 ${index}번째` : `${total}개 중 ${index}번째` }
}
