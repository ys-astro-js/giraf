/**
 * Pinned parameters, value connections and pset nodes (docs/node-structure-brief.md §3.4).
 *
 * A value output (diamond handle `value:<name>`) connects to a pinned
 * parameter (diamond handle `p:<key>`, key `name` or `pset.name`). Value
 * outputs come from a task's `value-output` schema components or from GIRAF
 * value nodes whose run component is `value-constant`, `value-header` or
 * `value-compute`. A `pset` node holds one IRAF pset; its output
 * (`pset`) feeds the pset input (`pset:<name>`) of every task that shares it,
 * and each parameter pinned on it is also a value output (`value:<param>`).
 * The server evaluates values (giraf/values.py); this module only describes them.
 */
import { uid, makeInstance, type Instance, type Source, type TaskMap } from "./task-map/model"
import { resolvedSource } from "./task-map/runs"
import type { Catalog, Param, ParameterSet, Spec, ValueRow } from "./workbench"
import { closesCycle, type ValuePorts } from "./flow-graph"

export const VALUE_HANDLE = "value:"
export const PARAM_HANDLE = "p:"
export const PSET_OUTPUT = "pset"
export const PSET_INPUT = "pset:"
const VALUE_RUNS = new Set(["value-constant", "value-header", "value-compute", "pset"])

export type ValueScalar = string | number | boolean
export type ValueResult = {
  kind?: string
  values: ValueScalar[]
  groups?: { keyword: string; values: Record<string, ValueScalar[]> }
  error?: undefined
} | { error: string; values?: undefined; groups?: undefined; kind?: undefined }
export type ValueResponse = {
  outputs: Record<string, ValueResult>
  parameters: Record<string, { value: ValueScalar; error?: undefined } | { error: string; value?: undefined }>
}

// foreach, for and if containers (lib/containers) are expanded by the runner.
const FLOW_RUNS = new Set(["foreach", "for", "if"])

/** Value and pset nodes are evaluated with the tasks they feed, never run as jobs. */
export const isValueNode = (spec: Spec | undefined) => !!spec?.run && VALUE_RUNS.has(spec.run)
export const isJobNode = (spec: Spec | undefined) => !isValueNode(spec) && !(spec?.run && FLOW_RUNS.has(spec.run))
export const isValueRole = (role: string) => role.startsWith(PARAM_HANDLE) || role.startsWith(PSET_INPUT)
export const isValueSource = (source: Source) =>
  source.kind !== "files" && !!source.outputRole &&
  (source.outputRole.startsWith(VALUE_HANDLE) || source.outputRole === PSET_OUTPUT)

const specOf = (catalog: Catalog, task: Instance | undefined) =>
  catalog.tasks.find((s) => s.name === task?.task)

// Names an expression reads: identifiers that are not called as functions.
// Letters of any script name a value (`값`), as in giraf/values.py.
const WORDS = new Set(["and", "or", "not", "INDEF"])
export function expressionNames(text: string): string[] {
  const names: string[] = []
  for (const match of text.replace(/"[^"]*"|'[^']*'/g, " ").matchAll(/(?<![\p{L}\p{N}_])[\p{L}_][\p{L}\p{N}_]*(\s*\()?/gu)) {
    const name = match[0].replace(/\s*\($/, "")
    if (!match[1] && !WORDS.has(name) && !names.includes(name)) names.push(name)
  }
  return names
}

const rowsOf = (task: Instance): ValueRow[] => task.draft.valueRows ?? []

// IRAF parameter types as value kinds: r/d real, i int, b bool, the rest strings.
const typeKinds: Record<string, string> = { r: "real", d: "real", i: "int", b: "bool" }

/** A pset node's parameter `pset.name` as its value output's name, if the node holds that pset. */
export function psetOutputName(task: Instance, key: string): string | undefined {
  const prefix = task.draft.pset ? task.draft.pset.name + "." : undefined
  return prefix && key.startsWith(prefix) ? key.slice(prefix.length) : undefined
}

/** The parameters a pset node offers as values: those pinned on it, in order. */
function psetOutputs(catalog: Catalog, task: Instance): { name: string; kind: string; param: Param }[] {
  const params = psetDefinition(catalog, task.draft.pset)?.parameters ?? []
  return (task.pinned ?? []).flatMap((key) => {
    const param = params.find((p) => p.name === psetOutputName(task, key))
    return param ? [{ name: param.name, kind: typeKinds[param.type] ?? "string", param }] : []
  })
}

/** Value outputs of a node: schema `value-output` components, a value node's rows or a pset node's pinned parameters. */
export function valueOutputs(spec: Spec | undefined, task: Instance, catalog: Catalog): { name: string; kind: string }[] {
  if (!spec) return []
  if (spec.values?.length) return spec.values.map((v) => ({ name: v.name, kind: v.kind || "real" }))
  if (spec.run === "pset") return psetOutputs(catalog, task).map(({ name, kind }) => ({ name, kind }))
  if (spec.run === "for") {
    // A for container's variable: an int when the whole range is.
    const flow = task.draft.flow ?? {}
    if (!flow.variable) return []
    const integer = [flow.start, flow.end, flow.step || "1"].every((v) => v !== undefined && v.trim() !== "" && Number.isInteger(Number(v)))
    return [{ name: flow.variable, kind: integer ? "int" : "real" }]
  }
  const named = rowsOf(task).filter((r) => r.name.trim())
  if (spec.run === "value-constant")
    return named.map((r) => {
      const entries = task.draft.partition ? Object.values(r.groups ?? {}) : [r.value]
      const numeric = entries.length > 0 && entries.every((v) => v.trim() !== "" && Number.isFinite(Number(v)))
      return { name: r.name, kind: numeric ? "real" : "string" }
    })
  if (spec.run === "value-header") return named.map((r) => ({ name: r.name, kind: "any" }))
  if (spec.run === "value-compute") return named.map((r) => ({ name: r.name, kind: "real" }))
  return []
}

/** The names a compute node's expressions read that no row defines. */
export function computeReads(task: Instance): string[] {
  const rows = rowsOf(task).map((r) => r.name)
  return [...new Set(rowsOf(task).flatMap((r) => expressionNames(r.value)))].filter((n) => !rows.includes(n))
}

/** The input a compute node offers while its expressions read none. */
export const COMPUTE_INPUT = "값"

/**
 * A compute node's inputs: the names its expressions read, or one
 * `값` to connect a value to before any row reads it.
 */
export function computeVariables(task: Instance): string[] {
  const reads = computeReads(task)
  return reads.length ? reads : [COMPUTE_INPUT]
}

/** The IRAF pset a pset node holds, from any task that declares it. */
export function psetDefinition(catalog: Catalog, pset: { name: string; task: string } | undefined): ParameterSet | undefined {
  if (!pset) return undefined
  for (const spec of catalog.tasks)
    for (const set of spec.parameterSets ?? [])
      if (set.task === pset.task) return set
  return undefined
}

export type ParameterEntry = { key: string; owner: string; param: Param }
/** Every parameter a node can show or receive a value into, by key. */
export function parameterEntries(catalog: Catalog, task: Instance): Map<string, ParameterEntry> {
  const spec = specOf(catalog, task)
  const entries = new Map<string, ParameterEntry>()
  if (!spec) return entries
  if (spec.run === "if") {
    // An if condition takes a value for each name it reads; other names are header keywords.
    for (const name of expressionNames(task.draft.flow?.condition ?? ""))
      entries.set(name, { key: name, owner: "", param: { name, type: "any", default: "", choices: [], prompt: "", min: "", max: "" } })
    return entries
  }
  if (spec.run === "value-compute") {
    for (const name of computeVariables(task))
      entries.set(name, { key: name, owner: "", param: { name, type: "any", default: "", choices: [], prompt: "", min: "", max: "" } })
    return entries
  }
  if (spec.run === "pset") {
    const set = psetDefinition(catalog, task.draft.pset)
    for (const param of set?.parameters ?? [])
      entries.set(`${task.draft.pset!.name}.${param.name}`, { key: `${task.draft.pset!.name}.${param.name}`, owner: task.draft.pset!.name, param })
    return entries
  }
  for (const param of spec.parameters) entries.set(param.name, { key: param.name, owner: "", param })
  for (const set of spec.parameterSets ?? [])
    for (const param of set.parameters)
      entries.set(`${set.name}.${param.name}`, { key: `${set.name}.${param.name}`, owner: set.name, param })
  return entries
}

/** The stored value of a parameter, before any value connection replaces it. */
export function storedValue(task: Instance, entry: ParameterEntry): string {
  const name = entry.param.name
  const value = entry.owner ? task.parameterSets?.[entry.owner]?.[name] : task.draft.parameters[name]
  return String(value ?? entry.param.default ?? "")
}

/** Connections that put a value into one of the node's parameters. */
export const valueLinksInto = (map: TaskMap, id: string) =>
  map.connections.filter((c) => c.target === id && c.role.startsWith(PARAM_HANDLE))

/** Keys pinned on the node, in order; a connected parameter is always pinned. */
export function pinnedKeys(map: TaskMap, catalog: Catalog, task: Instance): string[] {
  const entries = parameterEntries(catalog, task)
  const run = specOf(catalog, task)?.run
  if (run === "value-compute") return [...entries.keys()]
  if (run && FLOW_RUNS.has(run)) return []
  const connected = valueLinksInto(map, task.id).map((c) => c.role.slice(PARAM_HANDLE.length))
  return [...new Set([...(task.pinned ?? []), ...connected])].filter((key) => entries.has(key))
}

/** Psets of a task fed by a pset node: `pset:<name>` connections. */
export const psetLinksInto = (map: TaskMap, id: string) =>
  map.connections.filter((c) => c.target === id && c.role.startsWith(PSET_INPUT))

/** The pset node feeding a task's pset, if any. */
export function psetSource(map: TaskMap, id: string, name: string): Instance | undefined {
  const link = map.connections.find((c) => c.target === id && c.role === PSET_INPUT + name)
  const from = link?.source
  return from && from.kind !== "files" ? map.tasks.find((t) => t.id === from.taskId) : undefined
}

export function togglePinned(task: Instance, key: string, pinned: boolean): Instance {
  const keys = (task.pinned ?? []).filter((k) => k !== key)
  return { ...task, pinned: pinned ? [...keys, key] : keys }
}

// IRAF parameter types: r/d real, i int, b bool, s/f strings.
const accepts: Record<string, string[]> = {
  real: ["r", "d", "i", "s"],
  int: ["r", "d", "i", "s"],
  bool: ["b", "s"],
  string: ["s", "f"],
}
const typeNames: Record<string, string> = { r: "real", d: "real", i: "int", b: "bool", s: "string", f: "file" }
export const acceptsValue = (kind: string, type: string) =>
  kind === "any" || type === "any" || (accepts[kind] ?? []).includes(type)


/** The names a compute row reads from its inputs, through the rows it reads (giraf/values.py). */
function rowInputs(rows: ValueRow[], name: string, through: string[] = []): string[] {
  const row = rows.find((r) => r.name === name)
  if (!row || through.includes(name)) return []
  return expressionNames(row.value).flatMap((n) =>
    n !== name && rows.some((r) => r.name === n) ? rowInputs(rows, n, [...through, name]) : [n])
}

/**
 * What each value of a value node reads, for cycle checks: a pset node's
 * parameter feeds its own value and the whole pset, a compute row reads the
 * names in its expression, a header row reads the node's files. A constant
 * reads nothing.
 */
export function valuePorts(map: TaskMap, catalog: Catalog): ValuePorts {
  return (id) => {
    const task = map.tasks.find((t) => t.id === id)
    const spec = specOf(catalog, task)
    if (!task || !isValueNode(spec)) return undefined
    const outputs = valueOutputs(spec, task, catalog).map((o) => VALUE_HANDLE + o.name)
    if (spec!.run === "pset") return (role) => {
      const name = role.startsWith(PARAM_HANDLE) ? psetOutputName(task, role.slice(PARAM_HANDLE.length)) : undefined
      return name ? [VALUE_HANDLE + name, PSET_OUTPUT] : [PSET_OUTPUT]
    }
    if (spec!.run === "value-compute") {
      const rows = rowsOf(task).filter((r) => r.name.trim())
      return (role) => role.startsWith(PARAM_HANDLE)
        ? rows.filter((r) => rowInputs(rows, r.name).includes(role.slice(PARAM_HANDLE.length))).map((r) => VALUE_HANDLE + r.name)
        : []
    }
    if (spec!.run === "value-constant") return () => []
    return () => outputs
  }
}

/** Connect a value output to a parameter, or a pset node to a task's pset. */
export function connectValue(
  map: TaskMap,
  catalog: Catalog,
  connection: { source: string; sourceHandle?: string | null; target: string; targetHandle?: string | null },
  replacingId?: string
): TaskMap {
  const source = map.tasks.find((t) => t.id === connection.source)
  const target = map.tasks.find((t) => t.id === connection.target)
  if (!source || !target) throw Error("연결할 노드를 찾을 수 없습니다.")
  const base = replacingId ? { ...map, connections: map.connections.filter((c) => c.id !== replacingId) } : map
  const sourceHandle = connection.sourceHandle ?? "", targetHandle = connection.targetHandle ?? ""
  if (source.id === target.id) throw Error("자기 자신에게는 연결할 수 없습니다.")
  if (sourceHandle === PSET_OUTPUT || targetHandle.startsWith(PSET_INPUT)) {
    const pset = source.draft.pset
    if (sourceHandle !== PSET_OUTPUT || !pset) throw Error("pset 입력에는 pset 노드만 연결할 수 있습니다.")
    if (!targetHandle.startsWith(PSET_INPUT)) throw Error("pset 출력은 작업의 pset 입력에 연결합니다.")
    const name = targetHandle.slice(PSET_INPUT.length)
    const set = specOf(catalog, target)?.parameterSets?.find((s) => s.name === name)
    if (!set || set.task !== pset.task) throw Error(`${pset.name} pset(${pset.task})을 쓰는 입력에만 연결할 수 있습니다.`)
    if (closesCycle(base, source.id, PSET_OUTPUT, target.id, PSET_INPUT + name, valuePorts(base, catalog))) throw Error("순환 연결은 만들 수 없습니다.")
    return replaceInto(base, target.id, PSET_INPUT + name, { kind: "pending", taskId: source.id, outputRole: PSET_OUTPUT })
  }
  if (!sourceHandle.startsWith(VALUE_HANDLE) || !targetHandle.startsWith(PARAM_HANDLE))
    throw Error("값 출력은 노드에 고정한 파라미터에만 연결할 수 있습니다.")
  const name = sourceHandle.slice(VALUE_HANDLE.length)
  const output = valueOutputs(specOf(catalog, source), source, catalog).find((o) => o.name === name)
  if (!output) throw Error("값 출력을 찾을 수 없습니다.")
  const key = targetHandle.slice(PARAM_HANDLE.length)
  const entry = parameterEntries(catalog, target).get(key)
  if (!entry) throw Error(`${key}: 파라미터를 찾을 수 없습니다.`)
  if (entry.param.connectable === false) throw Error(`${key}는 값을 연결받지 않는 파라미터입니다.`)
  if (!acceptsValue(output.kind, entry.param.type))
    throw Error(`${key}는 ${typeNames[entry.param.type] ?? entry.param.type} 파라미터입니다. ${name} 값은 ${output.kind}입니다.`)
  if (closesCycle(base, source.id, sourceHandle, target.id, targetHandle, valuePorts(base, catalog))) throw Error("순환 연결은 만들 수 없습니다.")
  const next = replaceInto(base, target.id, PARAM_HANDLE + key, { kind: "pending", taskId: source.id, outputRole: VALUE_HANDLE + name })
  // A connected parameter is shown on the node until it is disconnected.
  return { ...next, tasks: next.tasks.map((t) => t.id === target.id && !(t.pinned ?? []).includes(key) && !["value-compute", "if"].includes(specOf(catalog, t)?.run ?? "") ? togglePinned(t, key, true) : t) }
}

function replaceInto(map: TaskMap, target: string, role: string, source: Source): TaskMap {
  return {
    ...map,
    connections: [...map.connections.filter((c) => !(c.target === target && c.role === role)), { id: uid(), target, role, source }],
  }
}

/** The title a 값 node starts with, whatever it takes its values from. */
export const VALUE_TITLE = "값"

/**
 * For a label the user has not chosen (the kind's title, `값`, the held
 * pset's name, with the `2`, `3` that numbers copies): that number as
 * `" 2"` or `""`. A chosen label gives `undefined`.
 */
export function defaultLabelSuffix(catalog: Catalog, task: Instance): string | undefined {
  const spec = specOf(catalog, task)
  const [, base, suffix = ""] = task.label.match(/^(.*?)( \d+)?$/) ?? []
  const defaults = [VALUE_TITLE, task.task, spec?.taskName, spec?.title, task.draft.pset?.name]
  return !task.label || defaults.includes(base) ? suffix : undefined
}

/** Move a task's pset into its own node, connected back to the task. */
export function takeOutPset(map: TaskMap, catalog: Catalog, taskId: string, name: string): TaskMap {
  const task = map.tasks.find((t) => t.id === taskId)
  const psetSpec = catalog.tasks.find((s) => s.run === "pset")
  if (!task || !psetSpec) throw Error("pset 노드를 만들 수 없습니다.")
  const node = makeInstance(psetSpec, catalog, { drafts: {}, backend: task.backend, mapping: task.mapping, instrument: task.instrument, packageValues: task.packageValues })
  node.subflowId = task.subflowId
  if (task.position) node.position = { x: task.position.x - 264 - 80, y: task.position.y + 40 }
  return holdPset({ ...map, tasks: [...map.tasks, node] }, catalog, node.id, taskId, name)
}

/**
 * A pset node takes a task's pset: it copies the task's current values,
 * takes over the pset's pinned parameters and the values connected into
 * them, and feeds the task's pset row. A node that held another pset keeps
 * only the links that still fit.
 */
export function holdPset(map: TaskMap, catalog: Catalog, nodeId: string, taskId: string, name: string): TaskMap {
  const task = map.tasks.find((t) => t.id === taskId)
  const node = map.tasks.find((t) => t.id === nodeId)
  const set = specOf(catalog, task)?.parameterSets?.find((s) => s.name === name)
  if (!task || !node || !set || specOf(catalog, node)?.run !== "pset") throw Error("pset 노드를 만들 수 없습니다.")
  if (closesCycle(map, nodeId, PSET_OUTPUT, taskId, PSET_INPUT + name, valuePorts(map, catalog))) throw Error("순환 연결은 만들 수 없습니다.")
  const prefix = name + "."
  const held: Instance = {
    ...node,
    // A label that only named the old pset or the kind follows the new pset.
    label: defaultLabelSuffix(catalog, node) === undefined ? node.label : name,
    draft: { ...node.draft, pset: { name, task: set.task } },
    parameterSets: { [name]: structuredClone(task.parameterSets?.[name] ?? {}) },
    pinned: [...new Set([...(node.pinned ?? []).filter((k) => k.startsWith(prefix)), ...(task.pinned ?? []).filter((k) => k.startsWith(prefix))])],
  }
  // Value connections into the pset's parameters move to the node.
  const moved = map.connections.map((c) =>
    c.target === taskId && c.role.startsWith(PARAM_HANDLE + prefix) ? { ...c, target: nodeId } : c)
  const next = {
    ...map,
    tasks: map.tasks.map((t) => t.id === taskId ? { ...t, pinned: (t.pinned ?? []).filter((k) => !k.startsWith(prefix)) } : t.id === nodeId ? held : t),
    connections: moved,
  }
  // The task it took the pset from comes first among the tasks it feeds (psetUser).
  const kept = dropStaleLinks(next, catalog, nodeId).connections.filter((c) => !(c.target === taskId && c.role === PSET_INPUT + name))
  const feed = { id: uid(), target: taskId, role: PSET_INPUT + name, source: { kind: "pending" as const, taskId: nodeId, outputRole: PSET_OUTPUT } }
  const at = kept.findIndex((c) => c.source.kind !== "files" && c.source.taskId === nodeId && c.source.outputRole === PSET_OUTPUT)
  return { ...next, connections: at < 0 ? [...kept, feed] : [...kept.slice(0, at), feed, ...kept.slice(at)] }
}

/**
 * Removes a value node's connections whose handles it no longer has: rows
 * that are gone, parameters it no longer holds, a pset it no longer feeds.
 */
export function dropStaleLinks(map: TaskMap, catalog: Catalog, id: string): TaskMap {
  const task = map.tasks.find((t) => t.id === id)
  const spec = specOf(catalog, task)
  if (!task || !spec || !isValueNode(spec)) return map
  const outputs = new Set(valueOutputs(spec, task, catalog).map((o) => VALUE_HANDLE + o.name))
  const entries = parameterEntries(catalog, task)
  const inputs = new Set(spec.inputs.map((i) => i.name))
  const pset = task.draft.pset
  const kept = (c: TaskMap["connections"][number]) => {
    if (c.target === id)
      return c.role.startsWith(PARAM_HANDLE) ? entries.has(c.role.slice(PARAM_HANDLE.length)) : inputs.has(c.role)
    if (c.source.kind === "files" || c.source.taskId !== id) return true
    const role = c.source.outputRole ?? ""
    if (role === PSET_OUTPUT) {
      const name = c.role.slice(PSET_INPUT.length)
      const target = specOf(catalog, map.tasks.find((t) => t.id === c.target))
      return !!pset && target?.parameterSets?.find((s) => s.name === name)?.task === pset.task
    }
    return outputs.has(role)
  }
  return { ...map, connections: map.connections.filter(kept) }
}

/** The pset values a task runs with: a connected pset node's values replace its own. */
export function psetValues(map: TaskMap, task: Instance) {
  const sets = structuredClone(task.parameterSets ?? {})
  for (const link of psetLinksInto(map, task.id)) {
    const name = link.role.slice(PSET_INPUT.length)
    const node = psetSource(map, task.id, name)
    const held = node?.draft.pset && node.parameterSets?.[node.draft.pset.name]
    if (held) sets[name] = { ...sets[name], ...structuredClone(held) }
  }
  return sets
}

/** Apply resolved parameter values (`name` or `pset.name`) to a payload's settings. */
export function withValues<T extends { parameters: Record<string, unknown>; parameterSets: Record<string, Record<string, unknown>> }>(
  payload: T, values: Record<string, ValueScalar>
): T {
  const parameters = { ...payload.parameters }, parameterSets = { ...payload.parameterSets }
  for (const [key, value] of Object.entries(values)) {
    const [owner, name] = key.includes(".") ? [key.slice(0, key.lastIndexOf(".")), key.slice(key.lastIndexOf(".") + 1)] : ["", key]
    if (owner) parameterSets[owner] = { ...parameterSets[owner], [name]: value }
    else parameters[name] = value
  }
  return { ...payload, parameters, parameterSets }
}

type Ref = { node: string; output: string }
type ValueLink = { id: string; target: string; parameter: string; type: string; source: Ref; partition?: { keyword: string; value: string } }

const refOf = (source: Source): Ref | undefined =>
  source.kind !== "files" && source.outputRole?.startsWith(VALUE_HANDLE)
    ? { node: source.taskId!, output: source.outputRole.slice(VALUE_HANDLE.length) } : undefined

/** The partition a task runs for: the member its file inputs come from, if any. */
function targetPartition(map: TaskMap, id: string) {
  const link = map.connections.find((c) => c.target === id && !isValueRole(c.role) && c.source.kind !== "files" && c.source.partition)
  return link && link.source.kind !== "files" ? link.source.partition : undefined
}

/**
 * The value request for giraf/values.py: value nodes, links into task
 * parameters (through pset nodes), and the latest run of each task whose
 * value output is read. `inRun` names job nodes a workflow runs now; their
 * files are read from this run instead of the last one.
 */
export function valueRequest(map: TaskMap, catalog: Catalog, inRun: Set<string> = new Set()) {
  const runs: Record<string, string> = {}
  const latest = (id: string) => {
    const run = map.runs.filter((r) => r.instanceId === id).at(-1)
    if (run?.state === "completed" && !inRun.has(id)) runs[id] = run.id
  }
  const nodes = map.tasks.flatMap((task) => {
    const spec = specOf(catalog, task)
    // A for variable is a constant at its first number; each iteration replaces it.
    if (spec?.run === "for") {
      const flow = task.draft.flow ?? {}
      return flow.variable ? [{ id: task.id, run: "value-constant", rows: [{ name: flow.variable, value: flow.start ?? "" } as ValueRow],
        partition: null as string | null, files: [] as string[], fileLinks: [] as Record<string, unknown>[], inputs: {} as Record<string, Ref> }] : []
    }
    if (spec?.run === "pset") {
      // Each offered parameter is its stored value, or the value connected into it.
      const set = task.draft.pset?.name ?? ""
      const inputs: Record<string, Ref> = {}
      for (const c of valueLinksInto(map, task.id)) {
        const name = psetOutputName(task, c.role.slice(PARAM_HANDLE.length)), ref = refOf(c.source)
        if (!name || !ref) continue
        inputs[name] = ref
        latest(ref.node)
      }
      const rows = psetOutputs(catalog, task).map(({ name, param }) =>
        ({ name, value: storedValue(task, { key: `${set}.${name}`, owner: set, param }), type: param.type }))
      return [{ id: task.id, run: spec.run, rows, partition: null as string | null, files: [] as string[], fileLinks: [] as Record<string, unknown>[], inputs }]
    }
    if (!spec?.run || !["value-constant", "value-header", "value-compute"].includes(spec.run)) return []
    const files: string[] = []
    const fileLinks: Record<string, unknown>[] = []
    for (const c of map.connections.filter((c) => c.target === task.id && !isValueRole(c.role))) {
      if (c.source.kind !== "files" && c.source.taskId && inRun.has(c.source.taskId)) {
        fileLinks.push({ source: c.source.taskId, ...(c.source.outputRole ? { sourceRole: c.source.outputRole } : {}),
          ...(c.source.files ? { sourceFiles: c.source.files } : {}), ...(c.source.partition ? { sourcePartition: c.source.partition } : {}) })
        continue
      }
      const resolved = resolvedSource(map, c.source, "image")
      if (resolved.kind !== "pending") files.push(...resolved.ids)
    }
    const inputs = Object.fromEntries(valueLinksInto(map, task.id).flatMap((c) => {
      const ref = refOf(c.source)
      if (ref) latest(ref.node)
      return ref ? [[c.role.slice(PARAM_HANDLE.length), ref]] : []
    }))
    return [{ id: task.id, run: spec.run, rows: rowsOf(task).filter((r) => r.name.trim()).map((r) => ({ name: r.name, value: r.value, ...(r.groups ? { groups: r.groups } : {}) })),
      partition: task.draft.partition || null, files, fileLinks, inputs }]
  })
  const links: ValueLink[] = []
  for (const c of map.connections) {
    if (!c.role.startsWith(PARAM_HANDLE)) continue
    const ref = refOf(c.source)
    const target = map.tasks.find((t) => t.id === c.target)
    const spec = specOf(catalog, target)
    if (!ref || !target || !spec || spec.run === "value-compute") continue
    const key = c.role.slice(PARAM_HANDLE.length)
    const entry = parameterEntries(catalog, target).get(key)
    if (!entry) continue
    if (!map.tasks.some((t) => t.id === ref.node && isValueNode(specOf(catalog, t)))) latest(ref.node)
    if (spec.run === "pset") {
      // A pset node's parameter reaches every task that uses the node.
      for (const use of map.connections.filter((u) => u.source.kind !== "files" && u.source.taskId === target.id && u.role.startsWith(PSET_INPUT))) {
        const user = map.tasks.find((t) => t.id === use.target)
        const name = use.role.slice(PSET_INPUT.length)
        if (!user) continue
        const partition = targetPartition(map, user.id)
        links.push({ id: `${c.id}:${user.id}`, target: user.id, parameter: `${name}.${entry.param.name}`, type: entry.param.type, source: ref, ...(partition ? { partition } : {}) })
      }
      continue
    }
    const partition = targetPartition(map, target.id)
    links.push({ id: c.id, target: target.id, parameter: key, type: entry.param.type, source: ref, ...(partition ? { partition } : {}) })
  }
  return { nodes, links, runs }
}

/** Every value output that is drawn: node rows and connection labels. */
export function valueRefs(map: TaskMap, catalog: Catalog): Ref[] {
  return map.tasks.flatMap((task) => valueOutputs(specOf(catalog, task), task, catalog).map((o) => ({ node: task.id, output: o.name })))
}

const short = (value: ValueScalar) =>
  typeof value === "number" ? String(Number(value.toPrecision(4))) : typeof value === "boolean" ? (value ? "yes" : "no") : String(value)

/** A value for a row or a connection label: `3.21`, `B 3.38, V 3.07`, `8.28, 8.00 외 10개`. */
export function formatValue(result: ValueResult | undefined): string {
  if (!result || result.error !== undefined) return ""
  if (result.groups) return Object.entries(result.groups.values).map(([key, values]) => `${key || "값 없음"} ${formatList(values)}`).join(", ")
  return formatList(result.values)
}
function formatList(values: ValueScalar[]) {
  const distinct = [...new Set(values.map(short))]
  return distinct.length <= 2 ? distinct.join(", ") : `${distinct.slice(0, 2).join(", ")} 외 ${distinct.length - 2}개`
}
export const formatScalar = short

