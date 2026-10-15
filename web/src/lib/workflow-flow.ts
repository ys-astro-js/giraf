import {customOutput, customPortHandle, primaryOutputRole} from "./output-ports"
import {
  applyNodeChanges,
  Position,
  type Connection as FlowConnection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import { connect, type Instance, type TaskMap, type Subflow, type Source } from "@/lib/task-map"
import {
  connectionChoices,
  nodeGeometry,
  nodeLayout,
  nodeOutput,
  roleActive,
} from "./node-interaction"
import type { Catalog, Frame, Spec } from "./workbench"
import { subflowColor } from "./subflow"
import { helperKind } from "./helper-nodes"
import { compoundEdges, compoundPorts, memberConnection, COMPOUND_HEADER, COMPOUND_WIDTH } from "./compound"
import { collapsedAround, groupAncestors, groupContents, groupDepth, parentGroup } from "./group-nesting"
import { connectValue, isValueSource, parameterEntries, valueOutputs, PARAM_HANDLE, PSET_INPUT, PSET_OUTPUT, VALUE_HANDLE } from "./values"

function valueEnds(catalog: Catalog, source: Instance, target: Instance, sourceHandle: string, role: string) {
  const spec = catalog.tasks.find((s) => s.name === source.task)
  const from = sourceHandle === PSET_OUTPUT ? !!source.draft.pset
    : valueOutputs(spec, source, catalog).some((o) => VALUE_HANDLE + o.name === sourceHandle)
  const to = role.startsWith(PSET_INPUT) || parameterEntries(catalog, target).has(role.slice(PARAM_HANDLE.length))
  return from && to
}

export type TaskFlowNode = Node<
  {
    task: Instance
    geometry: Omit<ReturnType<typeof nodeGeometry>, "inputY"> & {
      inputY: Record<string, number>
    }
  },
  "task"
>
export type SubflowNode = Node<
  { group: Subflow; count: number; minWidth: number; minHeight: number },
  "subflow"
>
export type CompoundNode = Node<
  { group: Subflow; members: string[] } & ReturnType<typeof compoundPorts>,
  "compound"
>
export type WorkflowNode = TaskFlowNode | SubflowNode | CompoundNode
const matches = (task: Instance, search: string) =>
  `${task.task} ${task.label}`.toLowerCase().includes(search.toLowerCase())

export function flowNodes(
  map: TaskMap,
  catalog: Catalog,
  search = "",
  rows:Frame[] = [],
  collapseAll = false
): WorkflowNode[] {
  // Handles come from the drawn geometry; React Flow resets measured ports from them.
  const layout = nodeLayout(map, catalog, rows, collapseAll)
  const tasks: TaskFlowNode[] = map.tasks.map((task, i) => {
    const parent = map.subflows?.find((g) => g.id === task.subflowId)
    // Inside a collapsed group, at any depth, the compound node stands in.
    const covered = !!collapsedAround(map, task.id)
    const absolute = task.position ?? { x: layout[i].x, y: layout[i].y }
    const geometry = layout[i]
    return {
      id: task.id,
      type: "task",
      zIndex: map.view.selected === task.id ? 3 : 2,
      // React Flow clones connection state at completion; node data must be cloneable.
      data: {
        task,
        geometry: {
          ...geometry,
          inputY: Object.fromEntries(
            geometry.roles.map((role) => [
              role.name,
              geometry.inputY(role.name),
            ])
          ),
        },
      },
      // Saved positions are authoritative; React Flow allows overlap and negative coordinates.
      position: parent
        ? {
            x: absolute.x - parent.position.x,
            y: absolute.y - parent.position.y,
          }
        : absolute,
      parentId: parent?.id,
      hidden: covered,
      initialWidth: geometry.width,
      initialHeight: geometry.height,
      // The node sizes to its markup: collapsed, expanded or opened by a connection.
      style: { opacity: matches(task, search) ? 1 : 0.3 },
      handles: [
        {
          id: "output",
          type: "source",
          position: Position.Right,
          x: geometry.outputX,
          y: geometry.outputY,
        },
        ...geometry.outputs.filter(slot=>slot.handleId!=="output").map((slot)=>({id:slot.handleId,type:"source" as const,position:Position.Right,x:slot.x,y:slot.y})),
        ...geometry.roles.map((role) => ({
          id: role.name,
          type: "target" as const,
          position: Position.Left,
          x: 0,
          y: geometry.inputY(role.name),
        })),
        // Pinned parameters take values; pset inputs take a pset node.
        ...geometry.params.map((row) => ({ id: row.handleId, type: "target" as const, position: Position.Left, x: 0, y: row.y })),
        ...geometry.values.map((row) => ({ id: row.handleId, type: "source" as const, position: Position.Right, x: row.x, y: row.y })),
        ...(geometry.psetOutput ? [{ id: PSET_OUTPUT, type: "source" as const, position: Position.Right, x: geometry.outputX, y: geometry.psetOutputY }] : []),
      ],
      selected: map.view.selected === task.id,
      dragHandle: ".node-heading",
      ariaLabel: `${task.label} 작업`,
    }
  })
  const edges = map.subflows?.some((g) => g.collapsed) ? taskEdges(map, catalog) : []
  // A region inside another is a child node of its group; parents come first.
  const nested = (map.subflows ?? [])
    .map((group, i) => ({ group, i, depth: groupDepth(map, group.id) }))
    .sort((a, b) => a.depth - b.depth || a.i - b.i)
    .map(({ group }) => group)
  const groups: (SubflowNode | CompoundNode)[] = nested.map((group) => {
    const children = tasks.filter((t) => t.parentId === group.id)
    const inner = nested.filter((g) => parentGroup(map, g.id)?.id === group.id)
    const outer = parentGroup(map, group.id)
    const placed = {
      position: outer ? { x: group.position.x - outer.position.x, y: group.position.y - outer.position.y } : group.position,
      ...(outer ? { parentId: outer.id } : {}),
      hidden: !!collapsedAround(map, group.id),
    }
    const name = group.name
    if (group.collapsed) {
      const ports = compoundPorts(map, group, edges)
      return {
        id: group.id,
        type: "compound",
        zIndex: 2,
        data: { group, members: [...groupContents(map, group.id).tasks], ...ports },
        ...placed,
        initialWidth: ports.width,
        initialHeight: ports.height,
        style: { opacity: children.some((t) => matches(t.data.task, search)) ? 1 : 0.3 },
        handles: [
          ...ports.inputs.map((row) => ({ id: row.handleId, type: "target" as const, position: Position.Left, x: 0, y: row.y })),
          ...ports.outputs.map((row) => ({ id: row.handleId, type: "source" as const, position: Position.Right, x: ports.width, y: row.y })),
        ],
        dragHandle: ".subflow-heading",
        deletable: false,
        ariaLabel: `${name} 그룹`,
      }
    }
    // Regions inside it count as its children.
    const within = (g: Subflow) => ({ x: g.position.x - group.position.x, y: g.position.y - group.position.y })
    const minWidth = Math.max(
      360,
      ...children.map((t) => t.position.x + (t.initialWidth ?? 248) + 24),
      ...inner.map((g) => within(g).x + (g.collapsed ? COMPOUND_WIDTH : g.width) + 24)
    )
    const minHeight = Math.max(
      160,
      ...children.map((t) => t.position.y + t.data.geometry.occupiedHeight + 24),
      ...inner.map((g) => within(g).y + (g.collapsed ? COMPOUND_HEADER : g.height) + 24)
    )
    return {
      id: group.id,
      type: "subflow",
      // Above edges (1) by DOM order: the heading covers them, the see-through body does not.
      zIndex: 1,
      data: { group, count: children.length + inner.length, minWidth, minHeight },
      ...placed,
      style: {
        width: group.width,
        height: group.height,
      },
      initialWidth: group.width,
      initialHeight: group.height,
      dragHandle: ".subflow-heading",
      deletable: false,
      ariaLabel: `${name} 그룹`,
    }
  })
  return [...groups, ...tasks]
}
export function outputHandle(source: Source, spec: Spec | undefined, task?: Instance): string {
  // Value and pset outputs are named by their handle.
  if (isValueSource(source) && source.kind !== "files") return source.outputRole!
  if (source.kind === "files") return "output"
  const primary = primaryOutputRole(spec, task)
  if (primary && source.outputRole === primary && (!source.port || source.port === "output:" + primary)) return "output"
  // Ports of older documents' calibration groups are plain outputs now.
  if (source.port && !source.port.startsWith("output-group:")) return source.port
  return source.outputRole && (spec?.outputs?.length || 0)>1 ? "output:" + source.outputRole : "output"
}
export function flowEdges(map: TaskMap, catalog: Catalog, search = ""): Edge[] {
  return compoundEdges(map, taskEdges(map, catalog, search))
}
/** Edges between task nodes, ignoring collapsed groups. */
export function taskEdges(map: TaskMap, catalog: Catalog, search = ""): Edge[] {
  return map.connections.flatMap((connection) => {
    const sourceId =
      connection.source.kind !== "files" ? connection.source.taskId : undefined
    const source = map.tasks.find((t) => t.id === sourceId)
    const target = map.tasks.find((t) => t.id === connection.target)
    // File inputs and results whose source was deleted are still shown in the input summary.
    if (!source || !target) return []
    const sourceHandle = outputHandle(connection.source,catalog.tasks.find(s=>s.name===source.task),source)
    const route = map.edgeRoutes?.[connection.id]
    const value = isValueSource(connection.source)
    // A renamed value row or compute input leaves its connection without handles.
    if (value && !valueEnds(catalog, source, target, sourceHandle, connection.role)) return []
    const targetGroup = map.view.selected === source.id || map.view.selected === target.id
      ? map.subflows?.find(group => group.id === target.subflowId) : undefined
    return [
      {
        id: connection.id,
        zIndex: 1,
        type: map.view.edgeStyle === "smoothstep" ? "smoothstep" : "default",
        data: {
          ...(route && route.source === source.id && route.target === target.id && route.sourceHandle === sourceHandle && route.targetHandle === connection.role
            ? { points: route.points } : {}),
          // A collapsed target hides its input rows; the edge names the role instead.
          role: connection.role.startsWith(PARAM_HANDLE) ? connection.role.slice(PARAM_HANDLE.length) : connection.role,
          // A value connection is dotted and shows its current value.
          ...(value && connection.source.kind !== "files" && connection.source.outputRole !== PSET_OUTPUT ? { value: true } : {}),
          // Edges of a file node can be hidden (view.fileNodes, lib/helper-nodes).
          fromFiles: [source, target].some((t) => helperKind(catalog.tasks.find((s) => s.name === t.task)) === "files"),
          // Value and pset connections can be hidden (view.valueNodes).
          fromValues: value,
        },
        source: source.id,
        target: target.id,
        sourceHandle,
        targetHandle: connection.role,
        style: {
          opacity: matches(source, search) && matches(target, search) ? 1 : 0.3,
          ...(targetGroup ? { "--xy-edge-stroke": subflowColor(targetGroup.color) } : {}),
        },
        className: value
          ? connection.role.startsWith(PSET_INPUT) ? "workflow-edge-pset" : "workflow-edge-value"
          : !target.expressions[connection.role] &&
          roleActive(target, connection.role, catalog)
            ? undefined
            : "workflow-edge-inactive",
        ariaLabel: `${source.label}에서 ${target.label} ${connection.role} 연결`,
      },
    ]
  })
}
/** Preview and commit deliberately share every connection rule. */
export function connectionFeedback(
  map: TaskMap,
  catalog: Catalog,
  rows: Frame[],
  connection: FlowConnection,
  replacingId?: string
): { valid: boolean; message: string } {
  try {
    connectFlow(map, catalog, rows, connection, replacingId)
    return { valid: true, message: "연결 가능" }
  } catch (error) {
    return { valid: false, message: (error as Error).message }
  }
}
export function connectFlow(
  map: TaskMap,
  catalog: Catalog,
  rows: Frame[],
  drawn: FlowConnection,
  replacingId?: string
): TaskMap {
  // Values go to pinned parameters, psets to pset inputs (lib/values).
  if ([drawn.sourceHandle, drawn.targetHandle].some((h) => h && (h.startsWith(VALUE_HANDLE) || h.startsWith(PARAM_HANDLE) || h === PSET_OUTPUT || h.startsWith(PSET_INPUT)))) {
    return connectValue(map, catalog, drawn, replacingId)
  }
  const connection = memberConnection(map, drawn)
  const sourceTask=map.tasks.find(t=>t.id===connection.source)
  const customPort=sourceTask?.outputPorts?.find(p=>customPortHandle(p.id)===connection.sourceHandle)
  if (!(customPort || connection.sourceHandle === "output" || connection.sourceHandle?.startsWith("output:")) || !connection.targetHandle)
    throw Error("출력과 입력 포트를 선택해 주세요.")
  const base = replacingId
    ? {
        ...map,
        connections: map.connections.filter((c) => c.id !== replacingId),
      }
    : map
  // Keep a frozen result version when only the target of an existing edge changes.
  const prior = map.connections.find((c) => c.id === replacingId)
  const outputRole=customPort ? customPort.outputRole : connection.sourceHandle?.startsWith("output:") ? connection.sourceHandle.slice(7) : primaryOutputRole(catalog.tasks.find(s=>s.name===sourceTask?.task),sourceTask)
  const source =
    prior &&
    prior.source.kind !== "files" &&
    prior.source.taskId === connection.source &&
    outputHandle(prior.source,catalog.tasks.find(s=>s.name===sourceTask?.task),sourceTask) === connection.sourceHandle &&
    prior.source.outputRole === outputRole
      ? prior.source
      : customPort ? customOutput(base,connection.source,customPort) : nodeOutput(base, connection.source, outputRole)
  return connectInputPort(base,catalog,rows,connection.target,connection.targetHandle,source)
}
/** Connect a source to one input of a task. */
export function connectInputPort(map:TaskMap,catalog:Catalog,rows:Frame[],targetId:string,role:string,source:Source):TaskMap {
  const target=map.tasks.find(t=>t.id===targetId)
  if(!target)throw Error('대상 작업이 없습니다.')
  if(!(source.kind==='files'&&!source.ids.length) && !connectionChoices(map,catalog,source,targetId,rows,role).some(s=>s.name===role))throw Error('이 입력에는 연결할 수 없습니다.')
  const spec=catalog.tasks.find(s=>s.name===target.task)!
  const multiple=spec.inputs.find(s=>s.name===role)?.multiple ?? catalog.ccdproc.inputs.find(s=>s.name===role)?.multiple ?? false
  return connect(map,targetId,role,source,multiple || target.task==='ccdproc'&&['zero','dark','flat'].includes(role))
}
export function changeFlowNodes(
  map: TaskMap,
  catalog: Catalog,
  changes: NodeChange<WorkflowNode>[]
): TaskMap {
  const relevant = changes.filter(
    (c) =>
      c.type === "position" ||
      c.type === "select" ||
      (c.type === "dimensions" &&
        c.resizing !== undefined &&
        map.subflows?.some((g) => g.id === c.id))
  )
  if (!relevant.length) return map
  const projected = flowNodes(map, catalog)
  const nodes = applyNodeChanges(relevant, projected)
  const moved = new Set(
    relevant
      .filter((c) => c.type === "position" && c.position)
      .map((c) => ("id" in c ? c.id : ""))
  )
  // Node positions are relative to their parent; the map keeps them absolute.
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const absolute = (id: string): { x: number; y: number } => {
    const node = byId.get(id)!
    const parent = node.parentId ? absolute(node.parentId) : { x: 0, y: 0 }
    return { x: parent.x + node.position.x, y: parent.y + node.position.y }
  }
  // Moving a group moves everything in it, at any depth.
  const carried = (id: string) => moved.has(id) || groupAncestors(map, id).some((g) => moved.has(g.id))
  const subflows = map.subflows?.map((g) => {
    const resize = relevant.find(
      (c) => c.type === "dimensions" && c.id === g.id
    )
    return {
      ...g,
      position: carried(g.id) && byId.has(g.id) ? absolute(g.id) : g.position,
      ...(resize?.type === "dimensions" && resize.dimensions
        ? resize.dimensions
        : {}),
    }
  })
  return {
    ...map,
    subflows,
    tasks: map.tasks.map((task) => {
      if (!carried(task.id)) return task
      if (!byId.has(task.id)) return task
      return { ...task, position: absolute(task.id) }
    }),
    view: {
      ...map.view,
      selected:
        nodes.find((n) => n.type === "task" && n.selected)?.id ??
        "",
    },
  }
}

export function flowViewport(view: TaskMap["view"]) {
  return {
    x: view.coordinateSystem === "react-flow" ? view.x : -view.x,
    y: view.coordinateSystem === "react-flow" ? view.y : -view.y,
    zoom: view.zoom,
  }
}

/** The flow point to center on so `rect` shows at the current zoom, or null when it is already in view. */
export function panTarget(
  rect: { x: number; y: number; width: number; height: number },
  viewport: { x: number; y: number; zoom: number },
  size: { width: number; height: number }
) {
  const left = -viewport.x / viewport.zoom
  const top = -viewport.y / viewport.zoom
  const inView =
    rect.x >= left &&
    rect.y >= top &&
    rect.x + rect.width <= left + size.width / viewport.zoom &&
    rect.y + rect.height <= top + size.height / viewport.zoom
  if (inView) return null
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
}

/** A shared output can carry several destination colors; retain each rather than choosing an arbitrary one. */
export function flowPortColors(edges: Edge[], nodeId: string, type: "source" | "target", handle: string | null | undefined): string[] {
  return [...new Set(edges.filter(edge => edge[type] === nodeId &&
    (type === "source" ? edge.sourceHandle : edge.targetHandle) === handle)
    .flatMap(edge => {
      const color = (edge.style as Record<string, unknown> | undefined)?.["--xy-edge-stroke"]
      return typeof color === "string" ? [color] : []
    }))]
}
