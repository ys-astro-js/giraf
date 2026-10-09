import { type Catalog } from "@/lib/workbench"
import { type Instance, type TaskMap } from "./model"
import { connectionRoles } from "./connections"
import { resolvedSource } from "./runs"
import { isJobNode, isValueRole, psetValues, valueRequest, withValues, type ValueScalar } from "@/lib/values"
import { COLLECT_PORT, flowRequests, flowRun, isContainerId } from "@/lib/containers"
const clone = <T,>(value: T): T => structuredClone(value)

/** `values` are resolved value connections (`name` or `pset.name`), see lib/values. */
export function payloadFor(map: TaskMap, id: string, catalog: Catalog, values: Record<string, ValueScalar> = {}) {
  const t = map.tasks.find((t) => t.id === id)
  if (!t) throw Error("task를 선택해 주세요.")
  const spec = catalog.tasks.find((s) => s.name === t.task)!
  if (!spec)
    throw Error(
      "설치된 작업 정의를 찾지 못했습니다. 작업 목록을 새로고침해 주세요."
    )
  const inputs = clone(t.draft.inputs)
  if (spec.preprocess)
    for (const s of catalog.ccdproc.inputs)
      inputs[s.name] = clone(t.preprocess.inputs[s.name] || [])
  const roles = connectionRoles(spec, catalog)
  for (const slot of roles) {
    const links = map.connections
      .filter((c) => c.target === id && c.role === slot.name)
      .map((c) => ({ ...c, source: resolvedSource(map, c.source, slot.kind) }))
    const flag = (
      {
        zero: "zerocor",
        dark: "darkcor",
        flat: "flatcor",
        illum: "illumcor",
        fringe: "fringecor",
        fixfile: "fixpix",
      } as Record<string, string>
    )[spec.adapter === "generic" && spec.name !== "ccdproc" ? "" : slot.name]
    const usesPrep =
      t.task === "ccdproc" ||
      (spec.preprocess &&
        (t.draft.parameters.process === "yes" || t.task.startsWith("mk")))
    const requiredNow =
      !flag ||
      (usesPrep &&
        (t.task === "ccdproc" ? t.draft : t.preprocess).parameters[flag] ===
          "yes") ||
      (t.task === "mkskyflat" && slot.name === "flat")
    if (
      requiredNow &&
      !t.expressions[slot.name] &&
      links.some((c) => c.source.kind === "pending")
    ) {
      const waiting = links.find((c) => c.source.kind === "pending")!
      const sourceId =
        waiting.source.kind === "pending" ? waiting.source.taskId : ""
      const sourceName =
        map.tasks.find((t) => t.id === sourceId)?.label || "연결한 작업"
      // A member alone takes the container's first item; lanes are decided by a run.
      if (isContainerId(map, sourceId))
        throw Error(
          flowRun(map, catalog, sourceId) === "if"
            ? `${slot.name}: ‘${sourceName}’의 참과 거짓 칸은 워크플로우를 실행할 때 정해집니다.`
            : `${slot.name}: ‘${sourceName}’에 목록이 없습니다. 목록 입력을 연결해 주세요.`
        )
      throw Error(
        `${slot.name}: 연결한 작업의 사용 가능한 결과가 없습니다. 캔버스에서 ‘${sourceName}’ 작업을 선택하고 실행해 주세요.`
      )
    }
    if (links.length) {
      inputs[slot.name] = links.flatMap((c) =>
        c.source.kind !== "pending" ? c.source.ids : []
      )
      if (
        requiredNow &&
        !t.expressions[slot.name] &&
        !slot.multiple &&
        inputs[slot.name].length > 1
      ) {
        throw Error(
          `${slot.name}: 파일 한 개가 필요합니다. 입력 항목을 열고 ‘파일’ → ‘찾아보기…’에서 사용할 결과 파일 하나를 선택해 주세요.`
        )
      }
    }
    inputs[slot.name] ??= []
  }
  if (spec.adapter !== "generic") inputs.instrument = clone(t.instrument)
  return withValues(taskPayload({ ...t, parameterSets: psetValues(map, t) }, inputs), values)
}

// Execution and live inspection serialize the same settings, but only execution
// requires all connections to be ready and valid before building a request.
function taskPayload(t: Instance, inputs: Record<string, string[]>) {
  return clone({
    calibration: undefined,
    task: t.task,
    outputs: clone(t.draft.outputs || {}),
    cursorCommands: clone(t.draft.cursorCommands || {}),
    textInputs: clone(t.draft.textInputs || {}),
    alignmentBinding: t.draft.alignmentBinding
      ? clone(t.draft.alignmentBinding)
      : undefined,
    destination: t.draft.destination ? clone(t.draft.destination) : undefined,
    parameterSets: clone(t.parameterSets || {}),
    instanceId: t.id,
    backend: t.backend,
    inputs,
    parameters: t.draft.parameters,
    output: t.draft.output,
    ccdproc:
      t.task === "ccdproc" ? t.draft.parameters : t.preprocess.parameters,
    ccdred: t.packageValues,
    mapping: t.mapping,
    section: t.draft.section,
    exam: t.draft.exam,
    expressions: t.expressions,
    filePolicy: t.filePolicy,
  })
}

/** `valueMap` is the whole workflow when only part of it runs (a group). */
export function workflowRequest(
  map: TaskMap,
  catalog: Catalog,
  workingDirectory: string,
  valueMap: TaskMap = map
) {
  // Value and pset nodes are evaluated by the server with the tasks they feed.
  const jobs = map.tasks.filter((t) => isJobNode(catalog.tasks.find((s) => s.name === t.task)))
  const jobIds = new Set(jobs.map((t) => t.id))
  // foreach, for and if containers run their members (lib/containers).
  const flows = flowRequests(map, catalog, jobIds).map((flow) => ({ ...flow, members: flow.members.filter((id) => jobIds.has(id)) }))
  const running = new Set([...jobIds, ...flows.map((f) => f.id)])
  const links = map.connections.flatMap((c) => {
    if (c.source.kind === "files" || !c.source.taskId) return []
    const sourceId = c.source.taskId
    if (!running.has(sourceId) || !running.has(c.target) || isValueRole(c.role)) return []
    const target = map.tasks.find((t) => t.id === c.target)!
    const spec = catalog.tasks.find((s) => s.name === target.task)!
    const role = c.role === COLLECT_PORT && isContainerId(map, c.target)
      ? { name: COLLECT_PORT, kind: "any", multiple: true }
      : connectionRoles(spec, catalog).find((s) => s.name === c.role)
    if (!role || target.expressions[c.role]) return []
    const flag = (
      {
        zero: "zerocor",
        dark: "darkcor",
        flat: "flatcor",
        illum: "illumcor",
        fringe: "fringecor",
        fixfile: "fixpix",
      } as Record<string, string>
    )[spec.adapter === "generic" && spec.name !== "ccdproc" ? "" : c.role]
    const prep = target.task === "ccdproc" ? target.draft : target.preprocess
    if (
      flag &&
      !(target.task === "mkskyflat" && c.role === "flat") &&
      !(
        (target.task === "ccdproc" ||
          (spec.preprocess &&
            (target.draft.parameters.process === "yes" ||
              target.task.startsWith("mk")))) &&
        prep.parameters[flag] === "yes"
      )
    )
      return []
    return [
      {
        source: c.source.taskId,
        ...(c.source.files !== undefined
          ? { sourceFiles: c.source.files }
          : {}),
        ...(c.source.group ? { sourceGroup: c.source.group } : {}),
        ...(c.source.partition ? { sourcePartition: c.source.partition } : {}),
        ...(c.source.outputRole ? { sourceRole: c.source.outputRole } : {}),
        target: c.target,
        role: c.role,
        kind: role.kind,
        multiple: role.multiple,
      },
    ]
  })
  const prepared = {
    ...map,
    connections: map.connections.map((c) =>
      c.source.kind === "pending" ||
      links.some((l) => l.target === c.target && l.role === c.role)
        ? { ...c, source: { kind: "files" as const, ids: [], label: "" } }
        : c
    ),
  }
  const values = valueRequest(valueMap, catalog, running)
  return {
    nodes: jobs.map((t) => ({
      id: t.id,
      label: t.label,
      payload: { ...payloadFor(prepared, t.id, catalog), workingDirectory },
    })),
    links,
    values: { ...values, links: values.links.filter((l) => running.has(l.target)) },
    // `connected` is for diagnostics only.
    flows: flows.map(({ connected, ...flow }) => (void connected, flow)),
  }
}

/** The live checker receives every edge, including ones the run planner excludes. */
export function workflowDiagnosticRequest(
  map: TaskMap,
  catalog: Catalog,
  workingDirectory: string
) {
  const jobs = map.tasks.filter((t) => isJobNode(catalog.tasks.find((s) => s.name === t.task)))
  const checked = new Set(jobs.map((t) => t.id))
  const connections = map.connections.filter((c) => checked.has(c.target) && !isValueRole(c.role) &&
    (c.source.kind === "files" || !c.source.taskId || checked.has(c.source.taskId) || isContainerId(map, c.source.taskId) ||
      !map.tasks.some((t) => c.source.kind !== "files" && t.id === c.source.taskId))).map((connection) => {
    const task = map.tasks.find((task) => task.id === connection.target)
    const spec = catalog.tasks.find((spec) => spec.name === task?.task)
    const role =
      spec &&
      connectionRoles(spec, catalog).find(
        (role) => role.name === connection.role
      )
    return {
      ...connection,
      source: resolvedSource(map, connection.source, role?.kind),
    }
  })
  return {
    workingDirectory,
    nodes: jobs.map((task) => {
      const spec = catalog.tasks.find((spec) => spec.name === task.task)
      const inputs = clone(task.draft.inputs)
      if (spec?.preprocess)
        for (const slot of catalog.ccdproc.inputs)
          inputs[slot.name] = clone(task.preprocess.inputs[slot.name] || [])
      const incoming = connections.filter(
        (connection) => connection.target === task.id
      )
      for (const role of new Set(incoming.map((connection) => connection.role)))
        inputs[role] = incoming
          .filter((connection) => connection.role === role)
          .flatMap((connection) =>
            connection.source.kind === "pending" ? [] : connection.source.ids
          )
      if (spec && spec.adapter !== "generic")
        inputs.instrument = clone(task.instrument)
      return {
        id: task.id,
        label: task.label,
        payload: { ...taskPayload({ ...task, parameterSets: psetValues(map, task) }, inputs), workingDirectory },
      }
    }),
    connections,
    flows: flowRequests(map, catalog, checked),
  }
}

export function workflowDiagnosticSignature(
  map: TaskMap,
  workingDirectory: string
) {
  return JSON.stringify({
    workingDirectory,
    tasks: map.tasks.map((task) => {
      const content = { ...task }
      delete content.position
      delete content.collapsed
      delete content.subflowId
      return content
    }),
    connections: map.connections,
    runs: map.runs,
    // Container membership decides what each foreach, for and if runs.
    members: map.tasks.map((task) => (isContainerId(map, task.subflowId) ? task.subflowId : "")),
  })
}
