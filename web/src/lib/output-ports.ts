import { acceptsAsset, type Catalog, type Frame, type Spec } from "./workbench"
import type { Instance, Source, TaskMap } from "@/lib/task-map"
import { assigned } from "@/lib/task-map/inputs"
import { latestRun } from "@/lib/task-map/runs"

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
export const portIdForRole = (role: string | undefined, primary: string | undefined) =>
  !role || role === primary ? "$default" : "$role:" + role
export function activeOutputSlots(task: Instance, spec: Spec, map?: TaskMap) {
  return (spec.outputs || []).filter((slot) => !slot.optional || !!task.draft.outputs?.[slot.name]?.trim() ||
    map?.connections.some((c) => c.source.kind !== "files" && c.source.taskId === task.id &&
      (c.source.outputRole === slot.name || c.source.port === "output:" + slot.name)))
}
/** With every output optional, the first one in use is primary (a file source's first kind). */
export function primaryOutputRole(spec: Spec | undefined, task?: Instance) {
  if (spec?.adapter !== "generic") return undefined
  const required = spec.outputs?.find((slot) => !slot.optional)
  return (required || (task && activeOutputSlots(task, spec)[0]) || spec.outputs?.[0])?.name
}
/** Outputs besides the primary one, each its own handle `output:<role>`. */
export function outputPorts(map: TaskMap, task: Instance, catalog: Catalog) {
  const spec = catalog.tasks.find((s) => s.name === task.task)
  if (!spec || (spec.outputs?.length || 0) <= 1) return []
  return activeOutputSlots(task, spec, map).filter((s) => s.name !== primaryOutputRole(spec, task))
    .map((s) => ({ ...s, outputRole: s.name, handleId: "output:" + s.name }))
}
export function editableOutputPorts(
  task: Instance,
  spec: Spec,
  map?: TaskMap
): CustomOutputPort[] {
  const base: CustomOutputPort[] = [
    { id: "$default", name: "", files: ["*"], outputRole: primaryOutputRole(spec, task) },
    ...((spec.outputs?.length || 0) > 1
      ? activeOutputSlots(task,spec,map).filter(s=>s.name!==primaryOutputRole(spec,task)).map((s) => ({
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
  port: CustomOutputPort
): Source {
  const selector = {
    taskId,
    port: customPortHandle(port.id),
    files: port.files,
    ...(port.outputRole ? { outputRole: port.outputRole } : {}),
  }
  const run = latestRun(map, taskId)
  const ids =
    run?.state === "completed"
      ? run.products
          .filter(
            (p) =>
              p.role !== "$log" &&
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
    connections: next.connections.flatMap((c) => {
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
      const updated = customOutput(next, taskId, port)
      if (updated.kind === "result" && catalog) {
        const target = next.tasks.find((t) => t.id === c.target)
        const spec = catalog.tasks.find((s) => s.name === target?.task)
        const slot =
          spec?.inputs.find((s) => s.name === c.role) ||
          (spec?.preprocess
            ? catalog.ccdproc.inputs.find((s) => s.name === c.role)
            : undefined)
        const products =
          latestRun(next, taskId)?.products || []
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

/**
 * A pass-through output is in use when its input holds files of its kind, so a
 * file source shows one port per kind it actually carries. Unknown files keep
 * the current state until their details load.
 */
export function syncPassOutputs(map: TaskMap, catalog: Catalog | null, rows: Frame[]): TaskMap {
  if (!catalog) return map
  const all = new Map([...rows, ...map.runs.flatMap((r) => r.products)].map((r) => [r.id, r]))
  let changed = false
  const tasks = map.tasks.map((task) => {
    const spec = catalog.tasks.find((s) => s.name === task.task)
    const pass = spec?.outputs?.filter((slot) => slot.mode === "pass" && slot.from) || []
    if (!pass.length) return task
    const outputs = { ...task.draft.outputs }
    const passed: Record<string, string[]> = {}
    for (const slot of pass) {
      // An IRAF task always passes on the copies it edited (hedit update=yes).
      if (!spec?.run) {
        outputs[slot.name] = "*"
        continue
      }
      const ids = assigned(map, task, slot.from!).ids
      const frames = ids.map((id) => all.get(id))
      if (frames.some((frame) => !frame)) continue
      outputs[slot.name] = frames.some((frame) => (frame!.asset || "image") === slot.kind) ? "*" : ""
      passed[slot.name] = ids.filter((id) => (all.get(id)!.asset || "image") === slot.kind)
    }
    const same = pass.every((slot) => (outputs[slot.name] || "") === (task.draft.outputs?.[slot.name] || "")) &&
      JSON.stringify(passed) === JSON.stringify(task.passed ?? {})
    if (same) return task
    changed = true
    return { ...task, passed, draft: { ...task.draft, outputs } }
  })
  return changed ? { ...map, tasks } : map
}
