import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api"
import { nodeGeometry } from "./node-interaction"
import { flowEdges, taskEdges } from "./workflow-flow"
import { compoundPorts } from "./compound"
import type { TaskMap } from "@/lib/task-map"
import type { Catalog, Frame } from "./workbench"
import { containerTask, flowBoundary } from "./containers"

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
  const collapsed = new Map((map.subflows ?? []).filter(group => group.collapsed).map(group => [group.id, group]))
  const groups = new Map<string, ElkNode>((map.subflows ?? []).filter(group => !group.collapsed).map(group => [group.id, {
    id: groupId(group.id),
    layoutOptions: options,
    children: [],
    width: 360,
    height: 160,
  }]))
  const nodes = new Map<string, ElkNode>()
  const children: ElkNode[] = [...groups.values()]
  // A collapsed group is one node with the compound's ports; its members keep their places.
  const plain = collapsed.size ? taskEdges(map, catalog) : []
  for (const group of collapsed.values()) {
    const container = containerTask(map, group.id)
    const ports = compoundPorts(map, group, plain, container ? flowBoundary(map, catalog, container) : undefined)
    const node: ElkNode = {
      id: groupId(group.id), width: ports.width, height: ports.height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: [
        ...ports.inputs.map(row => ({
          id: portId(group.id, "in", row.handleId), x: 0, y: row.y,
          width: 0, height: 0, layoutOptions: { "elk.port.side": "WEST" },
        })),
        ...ports.outputs.map(row => ({
          id: portId(group.id, "out", row.handleId), x: ports.width, y: row.y,
          width: 0, height: 0, layoutOptions: { "elk.port.side": "EAST" },
        })),
      ],
    }
    nodes.set(group.id, node)
    children.push(node)
  }
  for (const task of map.tasks) {
    if (task.subflowId && collapsed.has(task.subflowId)) continue
    // A container's task is its group node.
    if (containerTask(map, task.id)) {
      const group = groups.get(task.id)
      if (group) nodes.set(task.id, group)
      continue
    }
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
        ...[...geometry.outputs.filter(port => port.handleId !== "output"), ...geometry.members].map(port => ({
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
  // Edges between a container and its members stay out: ELK lays out the members inside it.
  const inner = (container: string, other: string) =>
    !!containerTask(map, container) && map.tasks.find(task => task.id === other)?.subflowId === container
  const edges = flowEdges(map, catalog).filter(edge => !edge.hidden && !inner(edge.source, edge.target) && !inner(edge.target, edge.source))
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
  const shift = (id: string) => {
    const group = collapsed.get(id), node = placed.get(groupId(id))
    return group && node ? { x: node.x! - group.position.x, y: node.y! - group.position.y } : { x: 0, y: 0 }
  }
  // Routes inside a collapsed group move with it.
  const edgeRoutes: NonNullable<TaskMap["edgeRoutes"]> = Object.fromEntries(
    Object.entries(map.edgeRoutes ?? {}).flatMap(([id, route]) => {
      const group = map.tasks.find(task => task.id === route.target)?.subflowId
      if (!group || !collapsed.has(group) || map.tasks.find(task => task.id === route.source)?.subflowId !== group) return []
      const d = shift(group)
      return [[id, { ...route, points: route.points.map(p => ({ x: p.x + d.x, y: p.y + d.y })) }]]
    }))
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
      if (task.subflowId && collapsed.has(task.subflowId)) {
        const d = shift(task.subflowId), position = task.position ?? { x: 0, y: 0 }
        return { ...task, position: { x: position.x + d.x, y: position.y + d.y } }
      }
      const node = placed.get(taskId(task.id)) ?? placed.get(groupId(task.id))!
      return { ...task, position: { x: node.x!, y: node.y! } }
    }),
    ...(map.subflows ? { subflows: map.subflows.map(group => {
      const node = placed.get(groupId(group.id))!
      return group.collapsed
        ? { ...group, position: { x: node.x!, y: node.y! } }
        : { ...group, position: { x: node.x!, y: node.y! }, width: node.width!, height: node.height! }
    }) } : {}),
  }
}
