import type { Edge } from "@xyflow/react"
import type { Instance, Subflow, TaskMap } from "@/lib/task-map"
import type { Diagnostic } from "./diagnostics"
import { NODE_METRICS } from "./node-interaction"
import { collapsedAround, groupContents } from "./group-nesting"
/** Matches .subflow-heading, so a group looks the same collapsed and expanded. */
export const COMPOUND_HEADER = 56
/** Wider than a task node: the group heading carries edit, count, expand and run. */
export const COMPOUND_WIDTH = 320
import { customPortHandle } from "./output-ports"

/** A collapsed group's boundary handles name the member port they stand for. */
export const compoundInputHandle = (member: string, role: string) => `in:${member}:${role}`
export const compoundOutputHandle = (member: string, handle: string) => `out:${member}:${handle}`
function parseHandle(handle: string | null | undefined, prefix: "in" | "out") {
  if (!handle?.startsWith(prefix + ":")) return undefined
  const rest = handle.slice(prefix.length + 1), at = rest.indexOf(":")
  return at < 0 ? undefined : { member: rest.slice(0, at), port: rest.slice(at + 1) }
}

export type CompoundPort = { handleId: string; member: string; port: string; label: string; summary: string; y: number; value?: boolean }

/** The collapsed group drawn in a task's place: the outermost one around it. */
export function collapsedGroupOf(map: TaskMap, taskId: string): Subflow | undefined {
  return collapsedAround(map, taskId)
}

function outputName(task: Instance | undefined, handle: string): string {
  const named = task?.outputPorts?.find((p) => customPortHandle(p.id) === handle)?.name.trim()
  if (named) return named
  if (handle.startsWith("output:")) return handle.slice(7)
  return `${task?.label ?? ""} 결과`.trim()
}

/** Rows follow connections that cross the group's boundary; `edges` are task-level edges. */
export function compoundPorts(map: TaskMap, group: Subflow, edges: Edge[]) {
  // Groups inside it are inside it too.
  const members = groupContents(map, group.id).tasks
  const label = (id: string) => map.tasks.find((t) => t.id === id)?.label ?? id
  const inputs = new Map<string, Omit<CompoundPort, "y">>()
  const sources = new Map<string, string[]>()
  const outputs = new Map<string, Omit<CompoundPort, "y">>()
  for (const edge of edges) {
    const inside = members.has(edge.target), from = members.has(edge.source)
    if (inside && !from) {
      const role = edge.targetHandle ?? ""
      const handleId = compoundInputHandle(edge.target, role)
      const names = [...new Set([...(sources.get(handleId) ?? []), label(edge.source)])]
      sources.set(handleId, names)
      inputs.set(handleId, { handleId, member: edge.target, port: role, label: role, summary: names.join(", ") })
    }
    if (from && !inside) {
      const port = edge.sourceHandle ?? "output"
      const handleId = compoundOutputHandle(edge.source, port)
      if (!outputs.has(handleId))
        outputs.set(handleId, { handleId, member: edge.source, port, label: outputName(map.tasks.find((t) => t.id === edge.source), port), summary: "" })
    }
  }
  const m = NODE_METRICS
  // The group's own 56px heading, then the task node's row rhythm (nodeGeometry).
  const inputsTop = 1 + COMPOUND_HEADER + m.sectionStart
  const inputsEnd = inputsTop + m.row * Math.max(inputs.size, 1) + m.sectionEnd
  const outputsTop = inputsEnd + m.sectionStart
  const height = (outputs.size ? outputsTop + m.row * outputs.size + m.sectionEnd : inputsEnd) + 1
  return {
    width: COMPOUND_WIDTH,
    height,
    inputs: [...inputs.values()].map((row, i) => ({ ...row, y: inputsTop + m.row / 2 + m.row * i })),
    outputs: [...outputs.values()].map((row, i) => ({ ...row, y: outputsTop + m.row / 2 + m.row * i })),
  }
}

/** Edges crossing a collapsed group attach to its boundary; edges inside it are hidden. */
export function compoundEdges(map: TaskMap, edges: Edge[]): Edge[] {
  return edges.map((edge) => {
    const from = collapsedGroupOf(map, edge.source), to = collapsedGroupOf(map, edge.target)
    // A collapsed container hides the edges between its inner ports and its members.
    if ((from && from.id === edge.target) || (to && to.id === edge.source)) return { ...edge, hidden: true }
    if (!from && !to) return edge
    if (from && from === to) return { ...edge, hidden: true }
    const source = from?.id ?? edge.source
    const target = to?.id ?? edge.target
    const sourceHandle = from ? compoundOutputHandle(edge.source, edge.sourceHandle ?? "output") : edge.sourceHandle
    const targetHandle = to ? compoundInputHandle(edge.target, edge.targetHandle ?? "") : edge.targetHandle
    const route = map.edgeRoutes?.[edge.id]
    const data = { ...edge.data }
    delete data.points
    if (route && route.source === source && route.target === target && route.sourceHandle === sourceHandle && route.targetHandle === targetHandle)
      data.points = route.points
    return { ...edge, source, target, sourceHandle, targetHandle, data }
  })
}

/** Connections drawn to or from a compound node address the member's real port. */
export function memberConnection<C extends { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null }>(map: TaskMap, connection: C): C {
  const isGroup = (id: string) => !!map.subflows?.some((g) => g.id === id)
  const out = isGroup(connection.source) ? parseHandle(connection.sourceHandle, "out") : undefined
  const into = isGroup(connection.target) ? parseHandle(connection.targetHandle, "in") : undefined
  return {
    ...connection,
    ...(out ? { source: out.member, sourceHandle: out.port } : {}),
    ...(into ? { target: into.member, targetHandle: into.port } : {}),
  }
}

/** Worst diagnostic first, then activity; "completed" only when every member's last run completed. */
export function compoundStatus(map: TaskMap, members: string[], issues: Diagnostic[]) {
  const own = issues.filter((issue) => issue.nodeId && members.includes(issue.nodeId))
  const severity = own.some((issue) => issue.severity === "error") ? "error" : own.length ? "warning" : undefined
  const states = members.map((id) => map.runs.filter((r) => r.instanceId === id).at(-1)?.state)
  const state = states.some((s) => s === "running" || s === "queued")
    ? "running"
    : members.length && states.every((s) => s === "completed")
      ? "completed"
      : undefined
  return { severity, state, issues: own }
}
