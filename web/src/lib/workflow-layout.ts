import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api"
import { nodeGeometry } from "./node-interaction"
import { flowEdges } from "./workflow-flow"
import type { TaskMap } from "./task-map"
import type { Catalog, Frame } from "./workbench"

const options: LayoutOptions = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.edgeRouting": "ORTHOGONAL",
  "elk.layered.mergeEdges": "false",
  "elk.spacing.edgeEdge": "16",
  "elk.layered.spacing.edgeEdgeBetweenLayers": "16",
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
        {
          id: portId(task.id, "out", "output"), x: geometry.outputX, y: geometry.outputY,
          width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" },
        },
        ...geometry.roles.map(role => ({
          id: portId(task.id, "in", role.role), x: 0, y: geometry.inputY(role.name),
          width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" },
        })),
        ...geometry.outputs.filter(port => port.handleId !== "output").map(port => ({
          id: portId(task.id, "out", port.handleId), x: port.x, y: port.y,
          width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" },
        })),
      ],
    }
    nodes.set(task.id, node)
    const parent = task.subflowId ? groups.get(task.subflowId) : undefined
    ;(parent?.children ?? children).push(node)
  }
  const endpoint = (id: string, side: string, handle: string, edgeId: string) => {
    const node = nodes.get(id)!
    const port = portId(id, side, handle)
    const original = node.ports?.find(p => p.id === port)
    if (!original) return node.id
    // Distinct ELK ports prevent shared UI handles from merging into a hyperedge.
    const routedPort = { ...original, id: JSON.stringify(["route-port", edgeId, side]) }
    node.ports!.push(routedPort)
    return routedPort.id
  }
  const elk = new ELK()
  const edges = flowEdges(map, catalog)
  const graph = await elk.layout({
    id: "root", layoutOptions: options, children,
    edges: edges.map(edge => ({
      id: JSON.stringify(["edge", edge.id]),
      sources: [endpoint(edge.source, "out", edge.sourceHandle ?? "output", edge.id)],
      targets: [endpoint(edge.target, "in", edge.targetHandle ?? "", edge.id)],
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
  const edgeRoutes: NonNullable<TaskMap["edgeRoutes"]> = {}
  const originals = new Map(edges.map(edge => [JSON.stringify(["edge", edge.id]), edge]))
  function collectRoutes(parent: ElkNode, x = 0, y = 0) {
    for (const edge of parent.edges ?? []) {
      const original = originals.get(edge.id)
      if (!original || !edge.sections?.length) continue
      const container = edge.container ? placed.get(edge.container) : undefined
      const offsetX = container?.x ?? x, offsetY = container?.y ?? y
      const points = edge.sections.flatMap(section =>
        [section.startPoint, ...(section.bendPoints ?? []), section.endPoint]
          .map(p => ({ x: p.x + offsetX, y: p.y + offsetY })))
      edgeRoutes[original.id] = {
        source: original.source, target: original.target,
        sourceHandle: original.sourceHandle, targetHandle: original.targetHandle, points,
      }
    }
    for (const child of parent.children ?? [])
      collectRoutes(child, x + (child.x ?? 0), y + (child.y ?? 0))
  }
  collectRoutes(graph)
  return {
    ...map,
    edgeRoutes,
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
