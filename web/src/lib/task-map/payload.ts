import { type Catalog } from "@/lib/workbench"
import { type Instance, type TaskMap } from "./model"
import { connectionRoles } from "./connections"
import { resolvedSource } from "./runs"
const clone = <T,>(value: T): T => structuredClone(value)

export function payloadFor(map: TaskMap, id: string, catalog: Catalog) {
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
  return taskPayload(t, inputs)
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

export function workflowRequest(
  map: TaskMap,
  catalog: Catalog,
  workingDirectory: string
) {
  const links = map.connections.flatMap((c) => {
    if (c.source.kind === "files" || !c.source.taskId) return []
    const sourceId = c.source.taskId
    if (!map.tasks.some((t) => t.id === sourceId)) return []
    const target = map.tasks.find((t) => t.id === c.target)!
    const spec = catalog.tasks.find((s) => s.name === target.task)!
    const role = connectionRoles(spec, catalog).find((s) => s.name === c.role)
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
  return {
    nodes: map.tasks.map((t) => ({
      id: t.id,
      label: t.label,
      payload: { ...payloadFor(prepared, t.id, catalog), workingDirectory },
    })),
    links,
  }
}

/** The live checker receives every edge, including ones the run planner excludes. */
export function workflowDiagnosticRequest(
  map: TaskMap,
  catalog: Catalog,
  workingDirectory: string
) {
  const connections = map.connections.map((connection) => {
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
    nodes: map.tasks.map((task) => {
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
        payload: { ...taskPayload(task, inputs), workingDirectory },
      }
    }),
    connections,
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
  })
}
