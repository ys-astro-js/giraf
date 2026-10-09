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
  if (run === "foreach") return { variable: "image" }
  if (run === "for") return { variable: "i", start: "1", end: "3", step: "1" }
  return { condition: "" }
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

/** `foreach image in object`, `for r = 2, 10, 2`, `if fwhm > 4.0`. */
export function flowStatement(map: TaskMap, catalog: Catalog, task: Instance): string {
  const spec = specOf(catalog, task)
  const s = flowSettings(task)
  if (!isFlowSpec(spec)) return task.label
  if (spec.run === "foreach") {
    const link = flowInput(map, catalog, task)
    const origin = link?.source
    const from = origin && origin.kind !== "files" ? map.tasks.find((t) => t.id === origin.taskId) : undefined
    const name = from ? `${from.label}${link?.source.partition ? " " + link.source.partition.value : ""}` : ""
    return `foreach ${s.variable ?? ""} in ${name}`.trim()
  }
  if (spec.run === "for")
    return `for ${s.variable ?? ""} = ${[s.start, s.end, s.step].filter((v) => v !== undefined && v.trim() !== "").join(", ")}`.trim()
  return `if ${s.condition ?? ""}`.trim()
}

/** What a member's input shows for a container's inner port: the variable, 참 or 거짓. */
export function innerPortLabel(map: TaskMap, source: Source): string | undefined {
  if (source.kind === "files" || !isContainerId(map, source.taskId)) return undefined
  if (source.outputRole === ITEM_PORT) return flowSettings(containerTask(map, source.taskId)).variable
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
    ports.push({ handleId: VALUE_HANDLE + s.variable, type: "source", side: "right", value: true, label: s.variable, x: FLOW_INSET, y: top })
  // An if body is two lanes, 참 above 거짓.
  const lane = spec.run === "if" ? FLOW_HEADER + Math.max(FLOW_ROW * 2, (group.height - FLOW_HEADER) / 2) : undefined
  for (const port of INNER[spec.run])
    ports.push({
      handleId: "output:" + port, type: "source", side: "right",
      label: port === ITEM_PORT ? s.variable : port === THEN_PORT ? "참" : "거짓",
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
  // The heading keeps the statement readable: about 8px a monospace character
  // beside the heading's controls, within a group card's width range.
  const width = Math.min(480, Math.max(320, 232 + 8 * flowStatement(map, catalog, task).length))
  return { inputs, outputs, width }
}

/** A new container: its task and an empty group with the same id, right of the canvas. */
export function addContainer(map: TaskMap, catalog: Catalog, spec: Spec, prefs: Preferences, layout: { x: number; y: number; width: number; height: number }[]): TaskMap {
  if (!isFlowSpec(spec)) throw Error("컨테이너 노드가 아닙니다.")
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

/**
 * What `{variable}` in a member's output names reads in the container's first
 * iteration (giraf/flows.py loop_value): the `for` start, the first partition
 * value, or the first file's stem.
 */
export function loopVariable(map: TaskMap, catalog: Catalog, member: Instance, rows: Frame[]): { variable: string; value: string } | undefined {
  const container = containerTask(map, member.subflowId)
  const run = flowRun(map, catalog, member.subflowId)
  const variable = flowSettings(container).variable
  if (!container || !variable || (run !== "foreach" && run !== "for")) return undefined
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

/** Where a connection to or from a container may go: inner ports reach members only. */
export function checkContainerConnection(map: TaskMap, connection: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null }) {
  const source = map.tasks.find((t) => t.id === connection.source)
  const target = map.tasks.find((t) => t.id === connection.target)
  if (isContainerId(map, connection.source)) {
    const inner = connection.sourceHandle !== "output:" + RESULTS_PORT
    if (inner && target?.subflowId !== connection.source)
      throw Error("안쪽 연결점은 컨테이너 안의 작업에만 연결합니다.")
    if (!inner && target?.subflowId === connection.source)
      throw Error("결과는 컨테이너 밖의 작업으로 내보냅니다.")
    if (connection.target === connection.source) throw Error("자기 자신에게는 연결할 수 없습니다.")
  }
  if (isContainerId(map, connection.target)) {
    const collect = connection.targetHandle === COLLECT_PORT
    if (collect && source?.subflowId !== connection.target)
      throw Error("모을 결과는 컨테이너 안의 작업에서 연결합니다.")
    if (!collect && source?.subflowId === connection.target)
      throw Error("컨테이너 입력은 밖에서 연결합니다.")
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
      label: task.label,
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
