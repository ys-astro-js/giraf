/**
 * 다른 값에서 가져오기: a parameter takes its value from a new 값 node.
 * The node starts as 직접 입력 holding the parameter's current value, so the
 * user can switch its 가져오기 to 파일 헤더 or 계산 from there.
 */
import { makeInstance, uid, type Instance, type TaskMap } from "./task-map/model"
import { nodeLayout } from "./node-interaction"
import { moveTaskToSubflow } from "./subflow"
import type { Catalog, Frame, Param } from "./workbench"
import {
  acceptsValue,
  isValueNode,
  parameterEntries,
  PARAM_HANDLE,
  psetSource,
  storedValue,
  togglePinned,
  VALUE_HANDLE,
  VALUE_TITLE,
} from "./values"

const specOf = (catalog: Catalog, task: Instance | undefined) =>
  catalog.tasks.find((s) => s.name === task?.task)

/** A parameter a value output can connect to. */
export const takesValue = (param: Param) =>
  param.connectable !== false && ["real", "int", "bool", "string"].some((kind) => acceptsValue(kind, param.type))

/**
 * Where a node's parameter takes a value connection: the node itself, or
 * the pset node feeding the parameter's pset, so every task sharing that
 * pset takes the same value.
 */
export function valueTarget(map: TaskMap, nodeId: string, key: string): { node: Instance; key: string } | undefined {
  const task = map.tasks.find((t) => t.id === nodeId)
  if (!task) return undefined
  const dot = key.lastIndexOf(".")
  const shared = dot > 0 ? psetSource(map, nodeId, key.slice(0, dot)) : undefined
  const pset = shared?.draft.pset
  return shared && pset ? { node: shared, key: `${pset.name}.${key.slice(dot + 1)}` } : { node: task, key }
}

/** The value connection a parameter takes, wherever it lands (valueTarget). */
export function parameterLink(map: TaskMap, nodeId: string, key: string) {
  const target = valueTarget(map, nodeId, key)
  return target && map.connections.find((c) => c.target === target.node.id && c.role === PARAM_HANDLE + target.key)
}

/** The next 값 node's label: every 값 node is numbered together, whatever its 가져오기. */
export function nextValueLabel(map: TaskMap, catalog: Catalog): string {
  const count = map.tasks.filter((t) => isValueNode(specOf(catalog, t))).length
  return count ? `${VALUE_TITLE} ${count + 1}` : VALUE_TITLE
}

const GAP = 80, MARGIN = 24

/**
 * Makes a 직접 입력 값 node with one row, named after the parameter and
 * holding its current value, connects that row to the parameter (pinned),
 * places the node left of the parameter's row and selects it.
 */
export function takeValue(
  map: TaskMap,
  catalog: Catalog,
  nodeId: string,
  key: string,
  rows: Frame[] = [],
  id = uid()
): TaskMap {
  const target = valueTarget(map, nodeId, key)
  const spec = catalog.tasks.find((s) => s.run === "value-constant")
  const entry = target && parameterEntries(catalog, target.node).get(target.key)
  if (!target || !spec || !entry) throw Error("값 노드를 만들 수 없습니다.")
  if (!takesValue(entry.param)) throw Error(`${entry.param.name}는 값을 연결받지 않는 파라미터입니다.`)
  const dest = target.node
  const name = entry.param.name
  const node = makeInstance(spec, catalog, {
    drafts: {}, backend: dest.backend, mapping: dest.mapping, instrument: dest.instrument, packageValues: dest.packageValues,
  }, id)
  node.label = nextValueLabel(map, catalog)
  node.subflowId = dest.subflowId
  node.draft = { ...node.draft, valueRows: [{ name, value: storedValue(dest, entry) }] }
  // Not connectValue: an empty or non-numeric value is still connected, and diagnostics name it.
  const role = PARAM_HANDLE + target.key
  const next: TaskMap = {
    ...map,
    tasks: [
      ...map.tasks.map((t) => (t.id === dest.id && !(t.pinned ?? []).includes(target.key) ? togglePinned(t, target.key, true) : t)),
      node,
    ],
    connections: [
      ...map.connections.filter((c) => !(c.target === dest.id && c.role === role)),
      { id: uid(), target: dest.id, role, source: { kind: "pending", taskId: node.id, outputRole: VALUE_HANDLE + name } },
    ],
    view: { ...map.view, selected: node.id },
  }
  return place(map, next, catalog, rows, node.id, dest.id, role)
}

/**
 * Puts the new node left of the target, its value row level with the
 * parameter's row. The target keeps the place it is drawn at; when that
 * spot is taken, the node moves further left.
 */
function place(before: TaskMap, map: TaskMap, catalog: Catalog, rows: Frame[], nodeId: string, destId: string, role: string): TaskMap {
  // Where nodes are drawn: a saved position, else the automatic layout (workflow-flow).
  const shown = nodeLayout(before, catalog, rows).map((n, i) => ({ ...n, ...before.tasks[i].position }))
  const after = nodeLayout(map, catalog, rows)
  const at = shown.find((n) => n.id === destId)
  const dest = after.find((n) => n.id === destId)
  const node = after.find((n) => n.id === nodeId)
  if (!at || !dest || !node) return map
  const paramY = dest.params.find((p) => p.handleId === role)?.y ?? dest.outputY
  const position = { x: at.x - node.width - GAP, y: at.y + paramY - (node.values[0]?.y ?? node.outputY) }
  const groupOf = map.tasks.find((t) => t.id === destId)?.subflowId
  const blocked = [
    ...shown.filter((n) => n.id !== destId && n.width > 0),
    { x: at.x, y: at.y, width: dest.width, occupiedHeight: dest.occupiedHeight },
    ...(map.subflows ?? []).filter((g) => g.id !== groupOf).map((g) => ({ ...g.position, width: g.width, occupiedHeight: g.height })),
  ]
  const hits = () => blocked.some((p) =>
    position.x < p.x + p.width + MARGIN && position.x + node.width + MARGIN > p.x &&
    position.y < p.y + p.occupiedHeight + MARGIN && position.y + node.occupiedHeight + MARGIN > p.y)
  while (hits()) position.x -= node.width + GAP
  // A target drawn by the automatic layout stays where it is drawn.
  const placed = {
    ...map,
    tasks: map.tasks.map((t) => (t.id === nodeId ? { ...t, position } : t.id === destId && !t.position ? { ...t, position: { x: at.x, y: at.y } } : t)),
  }
  return groupOf ? moveTaskToSubflow(placed, catalog, nodeId, groupOf, position) : placed
}
