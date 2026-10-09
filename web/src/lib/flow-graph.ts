import type { TaskMap } from "./task-map/model"

/**
 * A foreach, for or if container is a GIRAF node whose task id is also the id
 * of its group (lib/containers). Its boundary has two sides: what enters from
 * outside (its input, condition values) feeds the members through its inner
 * ports, and what the members hand back (`result`) leaves as `results`. Cycle
 * checks treat the two sides as separate vertices, so an inner connection
 * never looks like a loop through the container.
 */
export const COLLECT_PORT = "result"
export const RESULTS_PORT = "results"

export const isContainerId = (map: TaskMap, id: string | undefined) =>
  !!id && !!map.subflows?.some((g) => g.id === id) && map.tasks.some((t) => t.id === id)

function sourceVertex(map: TaskMap, id: string, outputRole?: string) {
  return isContainerId(map, id) ? (outputRole === RESULTS_PORT ? `out:${id}` : `in:${id}`) : id
}
function targetVertex(map: TaskMap, id: string, role?: string) {
  return isContainerId(map, id) ? (role === COLLECT_PORT ? `out:${id}` : `in:${id}`) : id
}

function reaches(map: TaskMap, from: string, to: string) {
  const next = new Map<string, string[]>()
  const add = (a: string, b: string) => next.set(a, [...(next.get(a) ?? []), b])
  for (const c of map.connections)
    if (c.source.kind !== "files" && c.source.taskId)
      add(sourceVertex(map, c.source.taskId, c.source.outputRole), targetVertex(map, c.target, c.role))
  for (const group of map.subflows ?? [])
    if (isContainerId(map, group.id)) add(`in:${group.id}`, `out:${group.id}`)
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length) {
    const vertex = stack.pop()!
    if (vertex === to) return true
    if (seen.has(vertex)) continue
    seen.add(vertex)
    stack.push(...(next.get(vertex) ?? []))
  }
  return false
}

/** Would a connection from `source` (its `outputRole`) into `target`'s `role` close a cycle? */
export function closesCycle(map: TaskMap, source: string, outputRole: string | undefined, target: string, role?: string) {
  const from = sourceVertex(map, source, outputRole)
  return reaches(map, targetVertex(map, target, role), from)
}
