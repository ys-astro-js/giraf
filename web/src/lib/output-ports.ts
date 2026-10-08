import { activeOutputSlots, primaryOutputRole, matchesGroup, type CalibrationGroup } from "./calibration-ports"
import { acceptsAsset, type Catalog, type Frame, type Spec } from "./workbench"
import type { Source, TaskMap } from "@/lib/task-map"
import { assigned } from "@/lib/task-map/inputs"

export type CustomOutputPort = {
  id: string
  name: string
  files: string[]
  outputRole?: string
  /** Splits the carried files into one member port per header value. */
  partition?: { keyword: string }
  /** The bundle shows its members as rows on the node. */
  open?: boolean
}
export const customPortHandle = (id: string) =>
  id === "$default"
    ? "output"
    : id.startsWith("$role:")
      ? "output:" + id.slice(6)
      : `output-custom:${id}`
export const partitionValue = (frame: Frame | undefined, keyword: string) =>
  (frame?.headers?.[keyword] ?? "").trim()
/** Sorted distinct header values; files without the keyword share "". */
export function partitionValues(ids: string[], frames: Frame[], keyword: string): string[] {
  const byId = new Map(frames.map((f) => [f.id, f]))
  return [...new Set(ids.map((id) => partitionValue(byId.get(id), keyword)))].sort((a, b) =>
    a.localeCompare(b, undefined, { numeric: true })
  )
}
/** A member port is its bundle's handle plus `~value`; base handles never contain `~`. */
export const memberHandle = (base: string, value: string) => `${base}~${encodeURIComponent(value)}`
export function parseMemberHandle(handle: string | null | undefined) {
  const at = handle?.indexOf("~") ?? -1
  if (!handle || at < 0) return undefined
  try {
    return { base: handle.slice(0, at), value: decodeURIComponent(handle.slice(at + 1)) }
  } catch {
    return undefined
  }
}
export const portIdForRole = (role: string | undefined, primary: string | undefined) =>
  !role || role === primary ? "$default" : "$role:" + role
/** The files a port carries now: a pass output's input, else its latest completed run. */
export function portFileIds(map: TaskMap, task: import("./task-map").Instance, port: CustomOutputPort): string[] {
  const passed = port.outputRole ? task.passed?.[port.outputRole] : undefined
  if (passed) return passed
  const run = map.runs.filter((r) => r.instanceId === task.id).at(-1)
  if (run?.state !== "completed") return []
  return run.products
    .filter((p) => p.role !== "$log" && (!port.outputRole || p.role === port.outputRole) && matchesFiles(p, port.files))
    .map((p) => p.id)
}
/** Header values a partitioned port splits into, keeping values still wired downstream. */
export function portMembers(map: TaskMap, task: import("./task-map").Instance, port: CustomOutputPort, rows: Frame[]): string[] {
  if (!port.partition) return []
  const { keyword } = port.partition
  const values = partitionValues(portFileIds(map, task, port), [...rows, ...map.runs.flatMap((r) => r.products)], keyword)
  for (const c of map.connections)
    if (c.source.kind !== "files" && c.source.taskId === task.id && c.source.port === customPortHandle(port.id) &&
      c.source.partition?.keyword === keyword && !values.includes(c.source.partition.value))
      values.push(c.source.partition.value)
  return values
}
export function editableOutputPorts(
  task: import("./task-map").Instance,
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
  port: CustomOutputPort,
  group?: CalibrationGroup,
  member?: string
): Source {
  const partition = port.partition && member !== undefined ? { keyword: port.partition.keyword, value: member } : undefined
  const selector = {
    ...(group ? { group } : {}),
    ...(partition ? { partition } : {}),
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
              (!partition || partitionValue(p, partition.keyword) === partition.value) &&
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
  const previous = map.tasks.find((t) => t.id === taskId)?.outputPorts?.find((p) => p.id === port.id)
  // Members are values of one keyword; another keyword (or none) has none of them.
  const regrouped = previous?.partition?.keyword !== port.partition?.keyword
  return {
    ...next,
    connections: next.connections.flatMap((c) => {
      const source = c.source
      if (regrouped && source.kind !== "files" && source.taskId === taskId &&
        source.partition && source.port === customPortHandle(port.id))
        return []
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
      const updated = customOutput(next, taskId, port, source.group, source.partition?.value)
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
    const primary = primaryOutputRole(spec, task)
    const outputs = { ...task.draft.outputs }
    const passed: Record<string, string[]> = {}
    for (const slot of pass) {
      const ids = assigned(map, task, slot.from!).ids
      const frames = ids.map((id) => all.get(id))
      if (frames.some((frame) => !frame)) continue
      outputs[slot.name] = frames.some((frame) => (frame!.asset || "image") === slot.kind) ? "*" : ""
      passed[slot.name] = ids.filter((id) => (all.get(id)!.asset || "image") === slot.kind)
      const keyword = task.outputPorts?.find((p) => p.id === portIdForRole(slot.name, primary))?.partition?.keyword
      if (keyword)
        for (const value of partitionValues(passed[slot.name], [...all.values()], keyword))
          passed[slot.name + "~" + value] = passed[slot.name].filter((id) => partitionValue(all.get(id), keyword) === value)
    }
    const same = pass.every((slot) => (outputs[slot.name] || "") === (task.draft.outputs?.[slot.name] || "")) &&
      JSON.stringify(passed) === JSON.stringify(task.passed ?? {})
    if (same) return task
    changed = true
    return { ...task, passed, draft: { ...task.draft, outputs } }
  })
  return changed ? { ...map, tasks } : map
}
