import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api"
import { nodeGeometry } from "./node-interaction"
import { flowEdges } from "./workflow-flow"
import type { TaskMap } from "./task-map"
import type { Catalog, Frame } from "./workbench"

const options: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.spacing.nodeNode": "64",
  "elk.layered.spacing.nodeNodeBetweenLayers": "112",
  "elk.padding": "[top=72,left=24,bottom=24,right=80]",
  "elk.randomSeed": "1",
}
const taskId = (id: string) => JSON.stringify(["task", id])
const groupId = (id: string) => JSON.stringify(["group", id])
const portId = (id: string, side: string, handle: string) =>
  JSON.stringify(["port", id, side, handle])

/** ELK owns ordering, spacing and compound bounds; stored task positions stay absolute. */
export async function autoLayoutMap(
  map: TaskMap,
  catalog: Catalog,
  rows: Frame[] = []
): Promise<TaskMap> {
  if (!map.tasks.length && !map.subflows?.length) return map
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js")
  const groups = new Map<string, ElkNode>((map.subflows ?? []).map(group => [group.id, {
    id: groupId(group.id),
    layoutOptions: options,
    children: [],
    width: 360,
    height: 160,
  }]))
  const nodes = new Map<string, ElkNode>()
  const children: ElkNode[] = [...groups.values()]
  for (const task of map.tasks) {
    const geometry = nodeGeometry(map, task, catalog, rows)
    const node: ElkNode = {
      id: taskId(task.id), width: geometry.width, height: geometry.height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: [
        ...geometry.roles.map(role => ({
          id: portId(task.id, "in", role.role), x: 0, y: geometry.inputY(role.name),
          width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" },
        })),
        ...geometry.outputs.map(port => ({
          id: portId(task.id, "out", port.handleId), x: port.x, y: port.y,
          width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" },
        })),
      ],
    }
    nodes.set(task.id, node)
    const parent = task.subflowId ? groups.get(task.subflowId) : undefined
    ;(parent?.children ?? children).push(node)
  }
  const endpoint = (id: string, side: string, handle: string) => {
    const node = nodes.get(id)!
    const port = portId(id, side, handle)
    return node.ports?.some(p => p.id === port) ? port : node.id
  }
  const elk = new ELK()
  const graph = await elk.layout({
    id: "root", layoutOptions: options, children,
    edges: flowEdges(map, catalog).map(edge => ({
      id: JSON.stringify(["edge", edge.id]),
      sources: [endpoint(edge.source, "out", edge.sourceHandle ?? "output")],
      targets: [endpoint(edge.target, "in", edge.targetHandle ?? "")],
    })),
  })
  const placed = new Map<string, ElkNode>()
  function collect(parent: ElkNode, x = 0, y = 0) {
    for (const node of parent.children ?? []) {
      const absolute = { ...node, x: x + (node.x ?? 0), y: y + (node.y ?? 0) }
      placed.set(node.id, absolute)
      collect(node, absolute.x, absolute.y)
    }
  }
  collect(graph)
  return {
    ...map,
    tasks: map.tasks.map(task => {
      const node = placed.get(taskId(task.id))!
      return { ...task, position: { x: node.x!, y: node.y! } }
    }),
    ...(map.subflows ? { subflows: map.subflows.map(group => {
      const node = placed.get(groupId(group.id))!
      return { ...group, position: { x: node.x!, y: node.y! }, width: node.width!, height: node.height! }
    }) } : {}),
  }
}
