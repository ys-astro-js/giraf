import type { TaskMap } from "./task-map/model"

/**
 * A loop region is a GIRAF node whose task id is also the id of its group
 * (lib/containers). It has no file ports; only its value outputs
 * (`value:<label>`) start connections, to tasks inside it.
 */
export const isContainerId = (map: TaskMap, id: string | undefined) =>
  !!id && !!map.subflows?.some((g) => g.id === id) && map.tasks.some((t) => t.id === id)

function sourceVertex(ports: ValuePorts, id: string, outputRole?: string) {
  return ports(id) ? `${id}>${outputRole ?? ""}` : id
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
    if (!fed) return id
    const vertex = `${id}<${role ?? ""}`
    for (const output of fed(role ?? "")) add(vertex, `${id}>${output}`)
    return vertex
  }
  for (const c of map.connections)
    if (c.source.kind !== "files" && c.source.taskId)
      add(sourceVertex(portsOf, c.source.taskId, c.source.outputRole), into(c.target, c.role))
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
  return reaches(map, ports, target, role, sourceVertex(portsOf, source, outputRole))
}
