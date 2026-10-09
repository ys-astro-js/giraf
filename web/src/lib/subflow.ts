import {
  type TaskMap,
  type Subflow,
  type SubflowColor,
  workflowRequest,
  payloadFor,
  removeTask,
} from "@/lib/task-map"
import { nodeLayout, roleActive } from "./node-interaction"
import type { Catalog } from "./workbench"
import { isValueNode, isValueRole } from "./values"
import { containerTask } from "./containers"
import { resolvedSource } from "./task-map/runs"
import { fitGroups, groupContents } from "./group-nesting"

export function saveSubflow(
  map: TaskMap,
  catalog: Catalog,
  input: { id: string; name: string; taskIds: string[]; color?: SubflowColor }
): TaskMap {
  const name = input.name.trim()
  const ids = new Set(input.taskIds)
  if (!name) throw Error("그룹 이름을 입력해 주세요.")
  if (!ids.size) throw Error("작업을 하나 이상 선택해 주세요.")
  if ([...ids].some((id) => !map.tasks.some((t) => t.id === id)))
    throw Error("삭제된 작업이 있습니다. 다시 선택해 주세요.")
  if (
    map.tasks.some(
      (t) => ids.has(t.id) && t.subflowId && t.subflowId !== input.id
    )
  )
    throw Error("다른 그룹에 속한 작업은 먼저 해당 그룹에서 빼 주세요.")
  const layout = nodeLayout(map, catalog)
  const tasks = map.tasks.map((t, i) => ({
    ...t,
    position: t.position ?? { x: layout[i].x, y: layout[i].y },
    subflowId: ids.has(t.id)
      ? input.id
      : t.subflowId === input.id
        ? undefined
        : t.subflowId,
  }))
  const members = tasks.filter((t) => ids.has(t.id))
  const x = Math.min(...members.map((t) => t.position.x)) - 24
  const y = Math.min(...members.map((t) => t.position.y)) - 72
  const right =
    Math.max(
      ...members.map((t) => t.position.x + layout[tasks.indexOf(t)].width)
    ) + 24
  const bottom =
    Math.max(
      ...members.map((t) => t.position.y + layout[tasks.indexOf(t)].height)
    ) + 24
  const group: Subflow = {
    id: input.id,
    name,
    color:
      input.color ??
      map.subflows?.find((g) => g.id === input.id)?.color ??
      "teal",
    position: { x, y },
    width: Math.max(360, right - x),
    height: bottom - y,
  }
  return {
    ...map,
    tasks,
    subflows: [...(map.subflows ?? []).filter((g) => g.id !== input.id), group],
  }
}

export function dissolveSubflow(map: TaskMap, id: string): TaskMap {
  // A container goes with its task; its members stay, as with a group.
  if (containerTask(map, id)) return removeTask(map, id)
  return {
    ...map,
    subflows: (map.subflows ?? []).filter((g) => g.id !== id),
    tasks: map.tasks.map((t) =>
      t.subflowId === id ? { ...t, subflowId: undefined } : t
    ),
  }
}

export function subflowRequest(
  map: TaskMap,
  catalog: Catalog,
  workingDirectory: string,
  id: string
) {
  const group = map.subflows?.find((g) => g.id === id)
  // A container runs with its members (lib/containers).
  const container = containerTask(map, id)
  // Regions inside it run with it.
  const inside = groupContents(map, id).tasks
  const tasks = [...map.tasks.filter((t) => inside.has(t.id)), ...(container ? [container] : [])]
  if (!group || tasks.length === (container ? 1 : 0)) throw Error("실행할 그룹 작업이 없습니다.")
  const ids = new Set(tasks.map((t) => t.id))
  const connections = map.connections.filter((c) => ids.has(c.target))
  // Validate external inputs before workflowRequest replaces internal dependencies.
  for (const task of tasks) {
    const external = connections.filter(
      (c) =>
        c.target === task.id &&
        !isValueRole(c.role) &&
        c.source.kind !== "files" &&
        (!c.source.taskId || !ids.has(c.source.taskId))
    )
    for (const c of external) {
      if (task.expressions[c.role] || !roleActive(task, c.role, catalog))
        continue
      const resolved = resolvedSource(map, c.source)
      if (
        resolved.kind === "pending" ||
        (resolved.kind === "result" && !resolved.ids.length)
      ) {
        const sourceId = resolved.taskId
        const label =
          map.tasks.find((t) => t.id === sourceId)?.label ?? "연결한 작업"
        throw Error(
          `${group.name}: 외부 작업 ‘${label}’의 결과가 없습니다. 해당 작업을 실행하고 사용할 결과를 연결해 주세요.`
        )
      }
    }
    if (task !== container) payloadFor({ ...map, connections: external }, task.id, catalog)
  }
  // Value and pset nodes stay available to the group's tasks; they never run as jobs.
  const values = map.tasks.filter((t) => !ids.has(t.id) && isValueNode(catalog.tasks.find((s) => s.name === t.task)))
  // Sources outside the group give the files they hold now: a file node's, or a run's results.
  const settled = connections.map((c) => {
    if (c.source.kind === "files" || !c.source.taskId || ids.has(c.source.taskId) || isValueRole(c.role)) return c
    const source = resolvedSource(map, c.source)
    return source.kind === "pending" ? c : { ...c, source }
  })
  return workflowRequest(
    { ...map, tasks: [...tasks, ...values], connections: settled },
    catalog,
    workingDirectory,
    map
  )
}

export const subflowColors = [
  { id: "teal", label: "청록" },
  { id: "blue", label: "파랑" },
  { id: "violet", label: "보라" },
  { id: "amber", label: "호박색" },
  { id: "rose", label: "장미색" },
  { id: "slate", label: "회색" },
] as const
export function subflowColor(color?: SubflowColor) {
  return `var(--subflow-${subflowColors.some((c) => c.id === color) ? color : "teal"})`
}
export function updateSubflow(
  map: TaskMap,
  id: string,
  values: { name: string; color: SubflowColor }
): TaskMap {
  const name = values.name.trim()
  if (!name) throw Error("그룹 이름을 입력해 주세요.")
  return {
    ...map,
    subflows: map.subflows?.map((g) =>
      g.id === id ? { ...g, name, color: values.color } : g
    ),
    // A container's name is its task's label (lib/containers).
    tasks: map.tasks.map((t) => (t.id === id ? { ...t, label: name } : t)),
  }
}
export function setSubflowCollapsed(map: TaskMap, id: string, collapsed: boolean): TaskMap {
  const hidden = collapsed && groupContents(map, id).tasks.has(map.view.selected)
  return {
    ...map,
    subflows: map.subflows?.map((g) => (g.id === id ? { ...g, collapsed: collapsed || undefined } : g)),
    // A hidden member cannot stay selected.
    view: hidden ? { ...map.view, selected: "" } : map.view,
  }
}
export function subflowDropTarget(
  groups: Subflow[],
  rect: { x: number; y: number; width: number; height: number }
) {
  const x = rect.x + rect.width / 2,
    y = rect.y + rect.height / 2
  return groups
    .filter(
      (g) =>
        x >= g.position.x &&
        x <= g.position.x + g.width &&
        y >= g.position.y + 56 &&
        y <= g.position.y + g.height
    )
    .sort((a, b) => a.width * a.height - b.width * b.height)[0]?.id
}
export function moveTaskToSubflow(
  map: TaskMap,
  catalog: Catalog,
  taskId: string,
  groupId: string | undefined,
  position: { x: number; y: number }
): TaskMap {
  if (!map.tasks.some((t) => t.id === taskId)) return map
  if (groupId && !map.subflows?.some((g) => g.id === groupId)) return map
  const next = {
    ...map,
    tasks: map.tasks.map((t) =>
      t.id === taskId ? { ...t, position, subflowId: groupId } : t
    ),
  }
  if (!groupId) return next
  const layout = nodeLayout(next, catalog)
  const size = (id: string) => layout[next.tasks.findIndex((t) => t.id === id)]
  return fitGroups(next, groupId, size)
}

/**
 * Move a region into another group (or out, with `groupId` undefined), its
 * members along: a region nests in the group its task is in. A plain group
 * has no task and stays at the top.
 */
export function moveGroupToGroup(
  map: TaskMap,
  catalog: Catalog,
  id: string,
  groupId: string | undefined,
  position: { x: number; y: number }
): TaskMap {
  const group = map.subflows?.find((g) => g.id === id)
  if (!group || !containerTask(map, id)) return map
  if (groupId && (groupId === id || !map.subflows?.some((g) => g.id === groupId) || groupContents(map, id).groups.has(groupId)))
    return map
  const d = { x: position.x - group.position.x, y: position.y - group.position.y }
  const inside = groupContents(map, id)
  const shift = (p: { x: number; y: number } | undefined) => (p ? { x: p.x + d.x, y: p.y + d.y } : p)
  const next: TaskMap = {
    ...map,
    subflows: map.subflows!.map((g) => (g.id === id || inside.groups.has(g.id) ? { ...g, position: shift(g.position)! } : g)),
    tasks: map.tasks.map((t) => {
      const moved = t.id === id || inside.tasks.has(t.id) ? { ...t, position: shift(t.position) } : t
      return t.id === id ? { ...moved, subflowId: groupId } : moved
    }),
  }
  if (!groupId) return next
  const layout = nodeLayout(next, catalog)
  const size = (taskId: string) => layout[next.tasks.findIndex((t) => t.id === taskId)]
  return fitGroups(next, groupId, size)
}

export { autoLayoutMap } from "./workflow-layout"
