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
 */
import { makeInstance, type Instance, type Source, type Subflow, type TaskMap } from "./task-map/model"
import { resolvedSource } from "./task-map/runs"
import { COLLECT_PORT, RESULTS_PORT, isContainerId } from "./flow-graph"
import { customPortHandle, partitionValue, partitionValues, portIdForRole } from "./output-ports"
import { primaryOutputRole } from "./calibration-ports"
import { expressionNames, PARAM_HANDLE, VALUE_HANDLE } from "./values"
import type { Catalog, Draft, Frame, Preferences, Spec } from "./workbench"

export { COLLECT_PORT, RESULTS_PORT, isContainerId }
export const FLOW_RUNS = ["foreach", "for", "if"] as const
export type FlowRun = (typeof FLOW_RUNS)[number]
export type FlowSettings = { variable?: string; start?: string; end?: string; step?: string; condition?: string }
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

export function defaultFlowSettings(run: FlowRun): FlowSettings {
  if (run === "foreach") return { variable: FILE_VARIABLE }
  if (run === "for") return { variable: NUMBER_VARIABLE, start: "1", end: "3", step: "1" }
  return { condition: "" }
}

const FILE_VARIABLE = "파일"
const NUMBER_VARIABLE = "숫자"
/**
 * The name output names use for the iteration (`{FILTER}`, `{파일}`, `{숫자}`):
 * set by the container, never typed.
 */
export function flowVariable(map: TaskMap, catalog: Catalog, task: Instance): string | undefined {
  const run = flowRun(map, catalog, task.id)
  if (run === "for") return NUMBER_VARIABLE
  if (run === "foreach") return flowPartition(map, catalog, task) ?? FILE_VARIABLE
  return undefined
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

/** The connection that feeds the container's list (foreach) or routed input (if). */
export function flowInput(map: TaskMap, catalog: Catalog, task: Instance) {
  const role = specOf(catalog, task)?.inputs[0]?.name
  return role ? map.connections.find((c) => c.target === task.id && c.role === role) : undefined
}

/** A foreach over a partitioned bundle iterates its groups (FILTER: B, V). */
export function flowPartition(map: TaskMap, catalog: Catalog, task: Instance): string | undefined {
  const link = flowInput(map, catalog, task)
  const from = link?.source
  if (!from || from.kind === "files" || from.partition) return undefined
  const source = map.tasks.find((t) => t.id === from.taskId)
  if (!source) return undefined
  const primary = primaryOutputRole(specOf(catalog, source), source)
  const port = source.outputPorts?.find((p) => p.partition &&
    (customPortHandle(p.id) === from.port || p.id === portIdForRole(from.outputRole, primary)))
  return port?.partition?.keyword
}

/** Names containers had before they were named for beginners. */
const OLD_NAMES = new Set<string>(FLOW_RUNS)
/** The container's name: the one a user gave it, or the node's own (각각 반복). */
export function containerLabel(map: TaskMap, catalog: Catalog, task: Instance): string {
  const spec = specOf(catalog, task)
  const name = map.subflows?.find((g) => g.id === task.id)?.name.trim()
  return name && !OLD_NAMES.has(name) ? name : spec?.taskName || spec?.title || task.label
}

/** What the container does, beside its name: `M67 FILTER별로`, `1부터 3까지 1씩`, `EXPTIME > 30`. */
export function flowStatement(map: TaskMap, catalog: Catalog, task: Instance): string {
  const spec = specOf(catalog, task)
  const s = flowSettings(task)
  if (!isFlowSpec(spec)) return task.label
  if (spec.run === "foreach") {
    const link = flowInput(map, catalog, task)
    const origin = link?.source
    const from = origin && origin.kind !== "files" ? map.tasks.find((t) => t.id === origin.taskId) : undefined
    if (!from) return "연결한 파일마다"
    const name = `${from.label}${link?.source.partition ? " " + link.source.partition.value : ""}`
    const keyword = flowPartition(map, catalog, task)
    return keyword ? `${name} ${keyword}별로` : `${name} 파일마다`
  }
  if (spec.run === "for") {
    const [start, end, step] = [s.start, s.end, s.step].map((v) => v?.trim())
    return start && end ? `${start}부터 ${end}까지 ${step || "1"}씩` : "범위를 정해 주세요"
  }
  return s.condition?.trim() || "조건을 정해 주세요"
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
export function flowPorts(map: TaskMap, catalog: Catalog, group: Subflow): { ports: FlowPort[]; lane?: number } {
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
  // An if body is two lanes, 참 above 거짓.
  const lane = spec.run === "if" ? FLOW_HEADER + Math.max(FLOW_ROW * 2, (group.height - FLOW_HEADER) / 2) : undefined
  for (const port of INNER[spec.run])
    ports.push({
      handleId: "output:" + port, type: "source", side: "right",
      label: port === ITEM_PORT ? ITEM_LABEL : port === THEN_PORT ? "참" : "거짓",
      x: FLOW_INSET, y: port === ELSE_PORT ? lane! + FLOW_ROW / 2 : top,
    })
  ports.push({ handleId: COLLECT_PORT, type: "target", side: "left", label: "결과", x: group.width - FLOW_INSET, y: top })
  ports.push({ handleId: "output:" + RESULTS_PORT, type: "source", side: "right", x: group.width, y: top })
  return { ports, lane }
}

/** Rows of a collapsed container that stand for its own boundary ports. */
export function flowBoundary(map: TaskMap, catalog: Catalog, task: Instance) {
  const spec = specOf(catalog, task)
  if (!isFlowSpec(spec)) return { inputs: [], outputs: [] }
  const link = flowInput(map, catalog, task)
  const origin = link?.source
  const from = origin && origin.kind !== "files" ? map.tasks.find((t) => t.id === origin.taskId)?.label : undefined
  const inputs = [
    ...spec.inputs.map((slot) => ({ handleId: slot.name, member: task.id, port: slot.name, label: slot.label, summary: from ?? "", value: false })),
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

/** The files the container hands its members first: one file, or the first group. */
export function firstItem(map: TaskMap, catalog: Catalog, task: Instance, rows: Frame[]): string[] | undefined {
  const link = flowInput(map, catalog, task)
  if (!link) return undefined
  const source = resolvedSource(map, link.source)
  if (source.kind === "pending" || !source.ids.length) return undefined
  const keyword = flowPartition(map, catalog, task)
  if (!keyword) return source.ids.slice(0, 1)
  const frames = [...rows, ...map.runs.flatMap((r) => r.products)]
  const first = partitionValues(source.ids, frames, keyword)[0]
  return source.ids.filter((id) => partitionValue(frames.find((f) => f.id === id), keyword) === first)
}

const formatNumber = (value: number) => String(Number.isInteger(value) ? value : Number(value.toFixed(10)))
const stem = (label: string) => {
  const base = label.split("/").at(-1) ?? ""
  const dot = base.lastIndexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

/** The variable a member's output names may use, inside a 각각 반복 or 반복. */
export function memberVariable(map: TaskMap, catalog: Catalog, member: Instance): string | undefined {
  const run = flowRun(map, catalog, member.subflowId)
  if (run !== "foreach" && run !== "for") return undefined
  return flowSettings(containerTask(map, member.subflowId)).variable || undefined
}

/**
 * What `{variable}` in a member's output names reads in the container's first
 * iteration (giraf/flows.py loop_value): the `for` start, the first partition
 * value, or the first file's stem.
 */
export function loopVariable(map: TaskMap, catalog: Catalog, member: Instance, rows: Frame[]): { variable: string; value: string } | undefined {
  const container = containerTask(map, member.subflowId)
  const run = flowRun(map, catalog, member.subflowId)
  const variable = memberVariable(map, catalog, member)
  if (!container || !variable) return undefined
  if (run === "for") {
    const start = number(flowSettings(container).start)
    return start === undefined ? undefined : { variable, value: formatNumber(start) }
  }
  const ids = firstItem(map, catalog, container, rows)
  if (!ids?.length) return undefined
  const frames = [...rows, ...map.runs.flatMap((r) => r.products)]
  const keyword = flowPartition(map, catalog, container)
  if (keyword) return { variable, value: partitionValue(frames.find((f) => f.id === ids[0]), keyword) }
  const frame = frames.find((f) => f.id === ids[0])
  return ids.length === 1 ? { variable, value: stem(frame?.label || frame?.name || ids[0]) } : undefined
}

/** Output names with `{variable}` replaced; other `{...}` stay as written. */
export function loopOutputNames(draft: Draft, loop: { variable: string; value: string } | undefined): Draft {
  if (!loop) return draft
  const mark = `{${loop.variable}}`
  return {
    ...draft,
    outputs: draft.outputs && Object.fromEntries(Object.entries(draft.outputs).map(([k, v]) => [k, v.replaceAll(mark, loop.value)])),
    output: { ...draft.output, name: draft.output.name.replaceAll(mark, loop.value) },
  }
}

/**
 * A member run on its own takes the container's first item (foreach); `passed`
 * holds it like a pass output, so resolvedSource finds it. Lanes of an if and
 * a for variable's first number are settled at run time or by the value request.
 */
export function syncContainerItems(map: TaskMap, catalog: Catalog | null, rows: Frame[]): TaskMap {
  if (!catalog || !map.subflows?.length) return map
  map = syncFlowVariables(map, catalog)
  let changed = false
  const tasks = map.tasks.map((task) => {
    if (flowRun(map, catalog, task.id) !== "foreach") return task
    const ids = firstItem(map, catalog, task, rows)
    const passed = ids ? { [ITEM_PORT]: ids } : undefined
    if (JSON.stringify(passed) === JSON.stringify(task.passed)) return task
    changed = true
    return { ...task, passed }
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
  partition?: string
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
    const link = flowInput(map, catalog, task)
    const sourceId = link && link.source.kind !== "files" ? link.source.taskId : undefined
    const resolved = link && !(sourceId && inRun.has(sourceId)) ? resolvedSource(map, link.source) : undefined
    const partition = run === "foreach" ? flowPartition(map, catalog, task) : undefined
    const range = run === "for" ? { start: number(s.start), end: number(s.end), step: number(s.step) } : {}
    return [{
      id: task.id,
      label: containerLabel(map, catalog, task),
      run,
      members: containerMembers(map, task.id).map((t) => t.id),
      variable: s.variable ?? "",
      files: resolved && resolved.kind !== "pending" ? resolved.ids : [],
      ...(partition ? { partition } : {}),
      ...Object.fromEntries(Object.entries(range).filter(([, v]) => v !== undefined)),
      condition: s.condition ?? "",
      connected: !!link,
    }]
  })
}

/** Progress text for a running container: `24개 중 9번째`, `5회 중 2번째`. */
export function flowProgress(run: FlowRun | undefined, progress: { index: number; total: number } | undefined) {
  if (!run || !progress || run === "if") return ""
  return run === "for" ? `${progress.total}회 중 ${progress.index}번째` : `${progress.total}개 중 ${progress.index}번째`
}
