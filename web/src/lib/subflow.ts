import {
  type TaskMap,
  type Subflow,
  type SubflowColor,
  workflowRequest,
  payloadFor,
} from "@/lib/task-map"
import { nodeLayout, roleActive } from "./node-interaction"
import type { Catalog } from "./workbench"

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
  const tasks = map.tasks.filter((t) => t.subflowId === id)
  if (!group || !tasks.length) throw Error("실행할 그룹 작업이 없습니다.")
  const ids = new Set(tasks.map((t) => t.id))
  const connections = map.connections.filter((c) => ids.has(c.target))
  // Validate external inputs before workflowRequest replaces internal dependencies.
  for (const task of tasks) {
    const external = connections.filter(
      (c) =>
        c.target === task.id &&
        c.source.kind !== "files" &&
        (!c.source.taskId || !ids.has(c.source.taskId))
    )
    for (const c of external) {
      if (task.expressions[c.role] || !roleActive(task, c.role, catalog))
        continue
      if (
        c.source.kind === "pending" ||
        (c.source.kind === "result" && !c.source.ids.length)
      ) {
        const sourceId = c.source.taskId
        const label =
          map.tasks.find((t) => t.id === sourceId)?.label ?? "연결한 작업"
        throw Error(
          `${group.name}: 외부 작업 ‘${label}’의 결과가 없습니다. 해당 작업을 실행하고 사용할 결과를 연결해 주세요.`
        )
      }
    }
    payloadFor({ ...map, connections: external }, task.id, catalog)
  }
  return workflowRequest(
    { ...map, tasks, connections },
    catalog,
    workingDirectory
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
  const members = next.tasks.filter((t) => t.subflowId === groupId)
  return {
    ...next,
    subflows: next.subflows?.map((g) => {
      if (g.id !== groupId) return g
      const bounds = members.map((t) => ({
        position: t.position ?? layout[next.tasks.indexOf(t)],
        size: layout[next.tasks.indexOf(t)],
      }))
      const x = Math.min(g.position.x, ...bounds.map((b) => b.position.x - 24))
      const y = Math.min(g.position.y, ...bounds.map((b) => b.position.y - 72))
      return {
        ...g,
        position: { x, y },
        width:
          Math.max(
            g.position.x + g.width,
            ...bounds.map((b) => b.position.x + b.size.width + 24)
          ) - x,
        height:
          Math.max(
            g.position.y + g.height,
            ...bounds.map((b) => b.position.y + b.size.height + 24)
          ) - y,
      }
    }),
  }
}

export { autoLayoutMap } from "./workflow-layout"
