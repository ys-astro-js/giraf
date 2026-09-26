import type { ElkNode } from "elkjs/lib/elk-api"
import {
  getIncomers,
  getOutgoers,
  MarkerType,
  type Node,
  type Edge,
} from "@xyflow/react"
import { flowEdges } from "./workflow-flow"
import { subflowColor } from "./subflow"
import { customPortHandle } from "./output-ports"
import type { TaskMap } from "@/lib/task-map"
import type { Catalog } from "./workbench"

export type DependencyData = {
  label: string
  command: string
  current: boolean
  color: string
  outputs: { id: string; name: string }[]
  sourcePorts: { id: string; name: string; x: number }[]
  sourceHandles: { id: string; x: number }[]
  inputPorts: { id: string; x: number }[]
}
export type DependencyFlowNode = Node<DependencyData, "dependency">
export type DependencyDirections = { previous: boolean; next: boolean }
export type DependencyGraph = { nodes: DependencyFlowNode[]; edges: Edge[] }

export function dependencyGraph(
  map: TaskMap,
  catalog: Catalog,
  id: string,
  all: boolean,
  directions: DependencyDirections = { previous: true, next: true }
): DependencyGraph {
  const nodes: DependencyFlowNode[] = map.tasks.map((task) => {
    const group = map.subflows?.find((group) => group.id === task.subflowId)
    const outputs = (task.outputPorts || [])
      .filter(
        (port) =>
          port.name.trim() !==
            (port.id.startsWith("$role:") ? port.id.slice(6) : "") ||
          port.files.length !== 1 ||
          port.files[0] !== "*" ||
          !port.id.startsWith("$")
      )
      .map((port) => ({
        id: customPortHandle(port.id),
        name: port.name || port.files.join(", ") || "출력",
      }))
    return {
      id: task.id,
      type: "dependency",
      position: { x: 0, y: 0 },
      width: Math.max(164, outputs.length * 68),
      height: outputs.length ? 96 : 68,
      data: {
        label: task.label,
        command: task.task,
        current: task.id === id,
        color: group ? subflowColor(group.color) : "var(--muted-foreground)",
        outputs,
        sourcePorts: [],
        sourceHandles: [],
        inputPorts: [],
      },
    }
  })
  const edges: Edge[] = flowEdges(map, catalog).map((edge) => {
    const source = nodes.find((node) => node.id === edge.source)!
    const custom = source.data.outputs.some(
      (port) => port.id === edge.sourceHandle
    )
    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      sourceHandle: custom ? edge.sourceHandle : "output",
      targetHandle: "input:" + edge.id,
      type: "dependency",
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: edge.className
        ? { strokeDasharray: "4 4", opacity: 0.5 }
        : undefined,
      ariaLabel: edge.ariaLabel,
    }
  })
  const included = new Set([id])
  const previousNodes = new Set<string>()
  const traversals = []
  if (directions.previous) traversals.push(getIncomers)
  if (directions.next) traversals.push(getOutgoers)
  for (const neighbors of traversals) {
    const seen = new Set([id])
    const queue = [{ id }]
    for (let index = 0; index < queue.length; index++) {
      for (const node of neighbors(queue[index], nodes, edges)) {
        included.add(node.id)
        if (neighbors === getIncomers) previousNodes.add(node.id)
        if (all && !seen.has(node.id)) {
          seen.add(node.id)
          queue.push(node)
        }
      }
    }
  }
  const tasksById = new Map(map.tasks.map((task) => [task.id, task]))
  const groupsById = new Map(map.subflows?.map((group) => [group.id, group]))
  const visibleEdges = edges
    .filter((edge) => included.has(edge.source) && included.has(edge.target))
    .map((edge) => {
      const previous = edge.target === id ||
        (previousNodes.has(edge.source) && previousNodes.has(edge.target))
      const neighbor = tasksById.get(previous ? edge.source : edge.target)
      const group = neighbor?.subflowId ? groupsById.get(neighbor.subflowId) : undefined
      const color = group ? subflowColor(group.color) : "var(--muted-foreground)"
      return {
        ...edge,
        style: { ...edge.style, stroke: color },
        markerEnd: typeof edge.markerEnd === "object"
          ? { ...edge.markerEnd, color }
          : edge.markerEnd,
      }
    })
  return {
    nodes: nodes
      .filter((node) => included.has(node.id))
      .map((node) => {
        const ports = [...node.data.outputs]
        if (
          !ports.some((port) => port.id === "output") &&
          (!ports.length ||
            visibleEdges.some(
              (edge) =>
                edge.source === node.id && edge.sourceHandle === "output"
            ))
        )
          ports.push({ id: "output", name: "" })
        return {
          ...node,
          data: {
            ...node.data,
            sourcePorts: ports.map((port, index) => ({
              ...port,
              x: (node.width! * (index + 0.5)) / ports.length,
            })),
            sourceHandles: ports.flatMap((port, index) => {
              const outgoing = visibleEdges.filter(
                (edge) => edge.source === node.id && edge.sourceHandle === port.id
              )
              const slotWidth = node.width! / ports.length
              const center = slotWidth * (index + 0.5)
              const spacing = Math.min(14, slotWidth / (outgoing.length + 1))
              return outgoing.map((edge, edgeIndex) => ({
                id: "source:" + edge.id,
                x: center + (edgeIndex - (outgoing.length - 1) / 2) * spacing,
              }))
            }),
            inputPorts: visibleEdges
              .filter((edge) => edge.target === node.id)
              .map((edge, index, array) => ({
                id: edge.targetHandle!,
                x: (node.width! * (index + 1)) / (array.length + 1),
              })),
          },
        }
      }),
    edges: visibleEdges.map((edge) => ({ ...edge, sourceHandle: "source:" + edge.id })),
  }
}

export async function layoutDependencies(
  graph: DependencyGraph
): Promise<DependencyGraph> {
  const { default: ELK } = await import("elkjs/lib/elk.bundled.js")
  const portId = (node: string, port: string) => JSON.stringify([node, port])
  const layout: ElkNode = await new ELK().layout({
    id: "dependencies",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      "elk.spacing.nodeNode": "40",
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.edgeEdge": "14",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "14",
      "elk.layered.mergeEdges": "false",
      "elk.layered.spacing.nodeNodeBetweenLayers": "64",
      "elk.padding": "[top=24,left=24,bottom=24,right=24]",
    },
    children: graph.nodes.map((node) => ({
      id: node.id,
      width: node.width,
      height: node.height,
      layoutOptions: { "elk.portConstraints": "FIXED_POS" },
      ports: [
        ...node.data.inputPorts.map((port) => ({
          id: portId(node.id, port.id),
          x: port.x,
          y: 0,
          width: 0,
          height: 0,
          layoutOptions: { "elk.port.side": "NORTH" },
        })),
        ...node.data.sourceHandles.map((port) => ({
          id: portId(node.id, port.id),
          x: port.x,
          y: node.height!,
          width: 0,
          height: 0,
          layoutOptions: { "elk.port.side": "SOUTH" },
        })),
      ],
    })),
    edges: graph.edges.map((edge) => ({
      id: edge.id,
      sources: [portId(edge.source, edge.sourceHandle!)],
      targets: [portId(edge.target, edge.targetHandle!)],
    })),
  })
  const positions = new Map(
    layout.children?.map((node) => [
      node.id,
      { x: node.x || 0, y: node.y || 0 },
    ])
  )
  return {
    ...graph,
    edges: graph.edges.map((edge) => {
      const section = layout.edges?.find((item) => item.id === edge.id)
        ?.sections?.[0]
      if (!section) throw new Error("Missing dependency edge route")
      return {
        ...edge,
        data: {
          points: [
            section.startPoint,
            ...(section.bendPoints || []),
            section.endPoint,
          ],
        },
      }
    }),
    nodes: graph.nodes.map((node) => ({
      ...node,
      position: positions.get(node.id)!,
    })),
  }
}
