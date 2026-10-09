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

function sourceVertex(map: TaskMap, ports: ValuePorts, id: string, outputRole?: string) {
  if (ports(id)) return `${id}>${outputRole ?? ""}`
  return isContainerId(map, id) ? (outputRole === RESULTS_PORT ? `out:${id}` : `in:${id}`) : id
}
function targetVertex(map: TaskMap, id: string, role?: string) {
  return isContainerId(map, id) ? (role === COLLECT_PORT ? `out:${id}` : `in:${id}`) : id
}

/**
 * A value node whose values each read only some of its inputs: for an input
 * role, the output roles it feeds. Other nodes are one vertex, every input
 * feeding every output.
 */
export type ValuePorts = (id: string) => ((role: string) => string[]) | undefined

function reaches(map: TaskMap, ports: ValuePorts | undefined, target: string, role: string | undefined, to: string) {
  const next = new Map<string, string[]>()
  const add = (a: string, b: string) => next.set(a, [...(next.get(a) ?? []), b])
  const feeds = new Map<string, ((role: string) => string[]) | undefined>()
  const portsOf = (id: string) => {
    if (!feeds.has(id)) feeds.set(id, ports?.(id))
    return feeds.get(id)
  }
  const into = (id: string, role: string | undefined) => {
    const fed = portsOf(id)
    if (!fed) return targetVertex(map, id, role)
    const vertex = `${id}<${role ?? ""}`
    for (const output of fed(role ?? "")) add(vertex, `${id}>${output}`)
    return vertex
  }
  for (const c of map.connections)
    if (c.source.kind !== "files" && c.source.taskId)
      add(sourceVertex(map, portsOf, c.source.taskId, c.source.outputRole), into(c.target, c.role))
  for (const group of map.subflows ?? [])
    if (isContainerId(map, group.id)) add(`in:${group.id}`, `out:${group.id}`)
  const seen = new Set<string>()
  const stack = [into(target, role)]
  while (stack.length) {
    const vertex = stack.pop()!
    if (vertex === to) return true
    if (seen.has(vertex)) continue
    seen.add(vertex)
    stack.push(...(next.get(vertex) ?? []))
  }
  return false
}

/**
 * Would a connection from `source` (its `outputRole`) into `target`'s `role`
 * close a cycle? With `ports`, a value node's values are separate vertices:
 * only a value that comes to read itself is a cycle.
 */
export function closesCycle(map: TaskMap, source: string, outputRole: string | undefined, target: string, role?: string, ports?: ValuePorts) {
  const portsOf = (id: string) => ports?.(id)
  return reaches(map, ports, target, role, sourceVertex(map, portsOf, source, outputRole))
}
