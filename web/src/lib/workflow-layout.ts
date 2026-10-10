import type { ElkNode, LayoutOptions } from "elkjs/lib/elk-api"
import { nodeGeometry } from "./node-interaction"
import { flowEdges, taskEdges } from "./workflow-flow"
import { compoundPorts } from "./compound"
import type { TaskMap } from "@/lib/task-map"
import type { Catalog, Frame } from "./workbench"
import { collapsedAround, parentGroup } from "./group-nesting"
import { BYPASS_PREFIX, bypassEdges, helperAnchors, hiddenHelpers } from "./helper-nodes"

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
  // A group inside a collapsed one moves with it; the rest are laid out where they sit.
  const shown = (map.subflows ?? []).filter(group => !collapsedAround(map, group.id))
  const collapsed = new Map(shown.filter(group => group.collapsed).map(group => [group.id, group]))
  // A group is at least wide enough for its heading, even with little inside.
  const minimum = (id: string) => {
    void id
    return { width: 360, height: 160 }
  }
  const groups = new Map<string, ElkNode>(shown.filter(group => !group.collapsed).map(group => [group.id, {
    id: groupId(group.id),
    layoutOptions: {
      ...options,
      "elk.nodeSize.constraints": "[MINIMUM_SIZE]",
      "elk.nodeSize.minimum": `(${minimum(group.id).width}, ${minimum(group.id).height})`,
    },
    children: [],
    ...minimum(group.id),
  }]))
  const nodes = new Map<string, ElkNode>()
  const children: ElkNode[] = []
  // A region inside another is a child of its group's node.
  const place = (id: string, node: ElkNode) => {
    const parent = parentGroup(map, id)
    ;((parent && groups.get(parent.id)?.children) ?? children).push(node)
  }
  for (const [id, node] of groups) place(id, node)
  // A collapsed group is one node with the compound's ports; its members keep their places.
  const plain = collapsed.size ? taskEdges(map, catalog) : []
  for (const group of collapsed.values()) {
    const ports = compoundPorts(map, group, plain)
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
    place(group.id, node)
  }
  // Hidden helper nodes stay out; their bypass edges keep the order (lib/helper-nodes).
  const hidden = hiddenHelpers(map, catalog)
  for (const task of map.tasks) {
    if (collapsedAround(map, task.id)) continue
    if (hidden.has(task.id)) continue
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
  const all = flowEdges(map, catalog)
  const edges = [...all, ...bypassEdges(all, hidden)].filter(edge =>
    !edge.hidden && !hidden.has(edge.source) && !hidden.has(edge.target))
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
  // What is inside a collapsed group moves as it moves.
  const shift = (id: string | undefined) => {
    const group = id ? collapsed.get(id) : undefined, node = id ? placed.get(groupId(id)) : undefined
    return group && node ? { x: node.x! - group.position.x, y: node.y! - group.position.y } : { x: 0, y: 0 }
  }
  const coveredBy = (id: string) => collapsedAround(map, id)?.id
  // Routes inside a collapsed group move with it.
  const edgeRoutes: NonNullable<TaskMap["edgeRoutes"]> = Object.fromEntries(
    Object.entries(map.edgeRoutes ?? {}).flatMap(([id, route]) => {
      const group = coveredBy(route.target)
      if (!group || coveredBy(route.source) !== group) return []
      const d = shift(group)
      return [[id, { ...route, points: route.points.map(p => ({ x: p.x + d.x, y: p.y + d.y })) }]]
    }))
  const originals = new Map(edges.map(edge => [JSON.stringify(["edge", edge.id]), edge]))
  function collectRoutes(parent: ElkNode, x = 0, y = 0) {
    for (const edge of parent.edges ?? []) {
      const original = originals.get(edge.id)
      if (!original || original.id.startsWith(BYPASS_PREFIX) || !edge.sections?.length) continue
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
  // A hidden node moves with the shown node it serves, keeping its place beside it.
  const anchors = helperAnchors(all, hidden)
  const moved = (id: string) => {
    const before = map.subflows?.find(g => g.id === id)?.position ?? map.tasks.find(t => t.id === id)?.position
    const node = placed.get(taskId(id)) ?? placed.get(groupId(id))
    return before && node ? { x: node.x! - before.x, y: node.y! - before.y } : undefined
  }
  return {
    ...map,
    edgeRoutes,
    tasks: map.tasks.map(task => {
      const covering = coveredBy(task.id)
      if (covering) {
        const d = shift(covering), position = task.position ?? { x: 0, y: 0 }
        return { ...task, position: { x: position.x + d.x, y: position.y + d.y } }
      }
      if (hidden.has(task.id)) {
        const anchor = anchors.get(task.id), d = anchor ? moved(anchor) : undefined
        return d && task.position ? { ...task, position: { x: task.position.x + d.x, y: task.position.y + d.y } } : task
      }
      const node = placed.get(taskId(task.id)) ?? placed.get(groupId(task.id))!
      return { ...task, position: { x: node.x!, y: node.y! } }
    }),
    ...(map.subflows ? { subflows: map.subflows.map(group => {
      const covering = coveredBy(group.id)
      if (covering) {
        const d = shift(covering)
        return { ...group, position: { x: group.position.x + d.x, y: group.position.y + d.y } }
      }
      const node = placed.get(groupId(group.id))!
      return group.collapsed
        ? { ...group, position: { x: node.x!, y: node.y! } }
        : { ...group, position: { x: node.x!, y: node.y! }, width: node.width!, height: node.height! }
    }) } : {}),
  }
}
