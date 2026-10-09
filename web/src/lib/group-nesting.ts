import type { Subflow, TaskMap } from "./task-map/model"

/**
 * Groups inside groups (docs/node-structure-brief.md §3.5): a loop region is a
 * task whose id is its group's, so a region sits in the group its task is in.
 * Plain groups have no task and stay at the top. Positions are absolute.
 */

const groupOf = (map: TaskMap, id: string | undefined) => (id ? map.subflows?.find((g) => g.id === id) : undefined)

/** The group a task or region is in. */
export function parentGroup(map: TaskMap, id: string): Subflow | undefined {
  return groupOf(map, map.tasks.find((t) => t.id === id)?.subflowId)
}

/** The groups around a task or group, innermost first; a group is not around itself. */
export function groupAncestors(map: TaskMap, id: string): Subflow[] {
  const found: Subflow[] = []
  let current = parentGroup(map, id)
  while (current && !found.includes(current) && current.id !== id) {
    found.push(current)
    current = parentGroup(map, current.id)
  }
  return found
}

export const groupDepth = (map: TaskMap, id: string) => groupAncestors(map, id).length

/** The outermost collapsed group around a task or group: what is drawn in its place. */
export const collapsedAround = (map: TaskMap, id: string): Subflow | undefined =>
  groupAncestors(map, id).filter((g) => g.collapsed).at(-1)

/** Tasks and groups inside a group, at any depth; a region's own task counts with its parent. */
export function groupContents(map: TaskMap, id: string): { tasks: Set<string>; groups: Set<string> } {
  const tasks = new Set<string>(), groups = new Set<string>()
  const stack = [id]
  while (stack.length) {
    const group = stack.pop()!
    for (const task of map.tasks) {
      if (task.subflowId !== group || tasks.has(task.id)) continue
      tasks.add(task.id)
      if (task.id !== id && groupOf(map, task.id) && !groups.has(task.id)) {
        groups.add(task.id)
        stack.push(task.id)
      }
    }
  }
  return { tasks, groups }
}

/**
 * Grow `id` and each group around it to hold what they contain, with the
 * group card's insets (24px sides and bottom, 72px above for the heading).
 */
export function fitGroups(map: TaskMap, id: string | undefined, sizeOf: (taskId: string) => { width: number; height: number }): TaskMap {
  let next = map
  for (let group = groupOf(next, id); group; group = parentGroup(next, group.id)) {
    const g = group
    const inner = [
      ...next.tasks.filter((t) => t.subflowId === g.id && !groupOf(next, t.id) && t.position)
        .map((t) => ({ ...t.position!, ...sizeOf(t.id) })),
      ...(next.subflows ?? []).filter((s) => parentGroup(next, s.id)?.id === g.id)
        .map((s) => ({ ...s.position, width: s.width, height: s.height })),
    ]
    if (!inner.length) continue
    const x = Math.min(g.position.x, ...inner.map((b) => b.x - 24))
    const y = Math.min(g.position.y, ...inner.map((b) => b.y - 72))
    const right = Math.max(g.position.x + g.width, ...inner.map((b) => b.x + b.width + 24))
    const bottom = Math.max(g.position.y + g.height, ...inner.map((b) => b.y + b.height + 24))
    if (x === g.position.x && y === g.position.y && right - x === g.width && bottom - y === g.height) continue
    next = {
      ...next,
      subflows: next.subflows?.map((s) => (s.id === g.id ? { ...s, position: { x, y }, width: right - x, height: bottom - y } : s)),
    }
  }
  return next
}
