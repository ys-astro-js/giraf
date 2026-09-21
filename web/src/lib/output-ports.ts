import { activeOutputSlots, primaryOutputRole, matchesGroup, type CalibrationGroup } from "./calibration-ports"
import { acceptsAsset, type Catalog, type Frame, type Spec } from "./workbench"
import type { Source, TaskMap } from "./task-map"

export type CustomOutputPort = {
  id: string
  name: string
  files: string[]
  outputRole?: string
}
export const customPortHandle = (id: string) =>
  id === "$default"
    ? "output"
    : id.startsWith("$role:")
      ? "output:" + id.slice(6)
      : `output-custom:${id}`
export function editableOutputPorts(
  task: import("./task-map").Instance,
  spec: Spec,
  map?: TaskMap
): CustomOutputPort[] {
  const base: CustomOutputPort[] = [
    { id: "$default", name: "", files: ["*"], outputRole: primaryOutputRole(spec) },
    ...((spec.outputs?.length || 0) > 1
      ? activeOutputSlots(task,spec,map).filter(s=>s.name!==primaryOutputRole(spec)).map((s) => ({
          id: "$role:" + s.name,
          name: s.name,
          files: ["*"],
          outputRole: s.name,
        }))
      : []),
  ]
  return [
    ...base.map(
      (p) => task.outputPorts?.find((saved) => saved.id === p.id) || p
    ),
    ...(task.outputPorts || []).filter((p) => !p.id.startsWith('$')),
  ]
}

/** Only * and ? are wildcards; all other filename characters are literal. */
export function matchesFiles(frame: Frame, files?: string[]): boolean {
  if (files === undefined) return true
  return files.some((pattern) => {
    const expression = pattern
      .split("")
      .map((char) =>
        char === "*"
          ? ".*"
          : char === "?"
            ? "."
            : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      )
      .join("")
    return new RegExp(`^${expression}$`, "su").test(frame.label)
  })
}

export function customOutput(
  map: TaskMap,
  taskId: string,
  port: CustomOutputPort,
  group?: CalibrationGroup
): Source {
  const selector = {
    ...(group ? { group } : {}),
    taskId,
    port: customPortHandle(port.id),
    files: port.files,
    ...(port.outputRole ? { outputRole: port.outputRole } : {}),
  }
  const run = map.runs.filter((r) => r.instanceId === taskId).at(-1)
  const ids =
    run?.state === "completed"
      ? run.products
          .filter(
            (p) =>
              p.role !== "$log" &&
              (!group || matchesGroup(p, group)) &&
              (!port.outputRole || p.role === port.outputRole) &&
              matchesFiles(p, port.files)
          )
          .map((p) => p.id)
      : []
  return ids.length && run
    ? { ...selector, kind: "result", runId: run.id, ids }
    : { ...selector, kind: "pending" }
}

export function updateOutputPort(
  map: TaskMap,
  taskId: string,
  port: CustomOutputPort,
  catalog?: Catalog
): TaskMap {
  const next = {
    ...map,
    tasks: map.tasks.map((t) =>
      t.id === taskId
        ? {
            ...t,
            outputPorts: (t.outputPorts || []).some((p) => p.id === port.id)
              ? t.outputPorts!.map((p) => (p.id === port.id ? port : p))
              : [...(t.outputPorts || []), port],
          }
        : t
    ),
  }
  return {
    ...next,
    connections: next.connections.map((c) => {
      const source = c.source
      if (
        source.kind === "files" ||
        source.taskId !== taskId ||
        !(
          source.port === customPortHandle(port.id) ||
          (!source.port &&
            (port.id === "$default"
              ? !source.outputRole
              : port.id === "$role:" + source.outputRole))
        )
      )
        return c
      if (
        JSON.stringify(source.files) === JSON.stringify(port.files) &&
        source.outputRole === port.outputRole
      )
        return c
      const updated = customOutput(next, taskId, port, source.group)
      if (updated.kind === "result" && catalog) {
        const target = next.tasks.find((t) => t.id === c.target)
        const spec = catalog.tasks.find((s) => s.name === target?.task)
        const slot =
          spec?.inputs.find((s) => s.name === c.role) ||
          (spec?.preprocess
            ? catalog.ccdproc.inputs.find((s) => s.name === c.role)
            : undefined)
        const products =
          next.runs.find((r) => r.id === updated.runId)?.products || []
        const ids = updated.ids.filter((id) =>
          products.some(
            (p) => p.id === id && (!slot || acceptsAsset(slot.kind, p.asset))
          )
        )
        if (!ids.length || (slot && !slot.multiple && ids.length > 1))
          return {
            ...c,
            source: { ...updated, kind: "pending" as const, taskId },
          }
        return { ...c, source: { ...updated, ids } }
      }
      return { ...c, source: updated }
    }),
  }
}

export function removeOutputPort(
  map: TaskMap,
  taskId: string,
  id: string
): TaskMap {
  return {
    ...map,
    tasks: map.tasks.map((t) =>
      t.id === taskId
        ? { ...t, outputPorts: t.outputPorts?.filter((p) => p.id !== id) }
        : t
    ),
    connections: map.connections.filter(
      (c) =>
        !(
          c.source.kind !== "files" &&
          c.source.taskId === taskId &&
          c.source.port === customPortHandle(id)
        )
    ),
  }
}
