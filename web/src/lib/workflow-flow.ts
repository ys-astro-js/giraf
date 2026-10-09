import {customOutput, customPortHandle, memberHandle, parseMemberHandle} from "./output-ports"
import {parsePort,sourceForGroup,targetGroupFor,matchesGroup,groupEqual,inputPorts,primaryOutputRole} from "./calibration-ports"
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
import { isSourceNode } from "./file-nodes"
import { compoundEdges, compoundPorts, memberConnection } from "./compound"
import {
  COLLECT_PORT,
  FLOW_HEADER,
  FLOW_ROW,
  checkContainerConnection,
  connectCollect,
  containerTask,
  flowBoundary,
  flowPorts,
  flowRun,
  flowStatement,
  isContainerId,
  isFlowSpec,
  type FlowPort,
  type FlowRun,
} from "./containers"
import { connectValue, isValueSource, parameterEntries, valueOutputs, PARAM_HANDLE, PSET_INPUT, PSET_OUTPUT, VALUE_HANDLE } from "./values"

function valueEnds(catalog: Catalog, source: Instance, target: Instance, sourceHandle: string, role: string) {
  const spec = catalog.tasks.find((s) => s.name === source.task)
  const from = sourceHandle === PSET_OUTPUT ? !!source.draft.pset
    : valueOutputs(spec, source).some((o) => VALUE_HANDLE + o.name === sourceHandle)
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
/** A foreach, for or if container drawn on its group (lib/containers). */
export type FlowView = { run: FlowRun; statement: string; ports: FlowPort[]; lane?: number }
export type SubflowNode = Node<
  { group: Subflow; count: number; minWidth: number; minHeight: number; flow?: FlowView },
  "subflow"
>
export type CompoundNode = Node<
  { group: Subflow; members: string[]; flow?: Omit<FlowView, "ports" | "lane"> } & ReturnType<typeof compoundPorts>,
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
      hidden: !!parent?.collapsed,
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
        ...[...geometry.outputs.filter(slot=>slot.handleId!=="output"),...geometry.members].map((slot)=>({id:slot.handleId,type:"source" as const,position:Position.Right,x:slot.x,y:slot.y})),
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
  const groups: (SubflowNode | CompoundNode)[] = (map.subflows ?? []).map((group) => {
    const children = tasks.filter((t) => t.parentId === group.id)
    // A container is its group plus a task holding its settings and ports.
    const container = containerTask(map, group.id)
    const run = flowRun(map, catalog, group.id)
    const flow = container && run ? { run, statement: flowStatement(map, catalog, container) } : undefined
    const name = flow?.statement ?? group.name
    if (group.collapsed) {
      const ports = compoundPorts(map, group, edges, container && flow ? flowBoundary(map, catalog, container) : undefined)
      return {
        id: group.id,
        type: "compound",
        zIndex: 2,
        data: { group, members: children.map((t) => t.id), ...(flow ? { flow } : {}), ...ports },
        position: group.position,
        initialWidth: ports.width,
        initialHeight: ports.height,
        style: { opacity: children.some((t) => matches(t.data.task, search)) || (container && matches(container, search)) ? 1 : 0.3 },
        handles: [
          ...ports.inputs.map((row) => ({ id: row.handleId, type: "target" as const, position: Position.Left, x: 0, y: row.y })),
          ...ports.outputs.map((row) => ({ id: row.handleId, type: "source" as const, position: Position.Right, x: ports.width, y: row.y })),
        ],
        dragHandle: ".subflow-heading",
        deletable: !!flow,
        ...(flow ? { selected: map.view.selected === group.id } : {}),
        ariaLabel: `${name} ${flow ? "컨테이너" : "그룹"}`,
      }
    }
    const view = flow ? { ...flow, ...flowPorts(map, catalog, group) } : undefined
    const minWidth = Math.max(
      360,
      ...children.map((t) => t.position.x + (t.initialWidth ?? 248) + 24)
    )
    const minHeight = Math.max(
      // An if keeps room for both lanes.
      view?.run === "if" ? FLOW_HEADER + FLOW_ROW * 4 : 160,
      ...children.map((t) => t.position.y + t.data.geometry.occupiedHeight + 24)
    )
    return {
      id: group.id,
      type: "subflow",
      zIndex: 0,
      data: { group, count: children.length, minWidth, minHeight, ...(view ? { flow: view } : {}) },
      position: group.position,
      style: {
        width: group.width,
        height: group.height,
      },
      initialWidth: group.width,
      initialHeight: group.height,
      ...(view
        ? {
            handles: view.ports.map((port) => ({
              id: port.handleId,
              type: port.type,
              position: port.side === "left" ? Position.Left : Position.Right,
              x: port.x,
              y: port.y,
            })),
            selected: map.view.selected === group.id,
          }
        : {}),
      dragHandle: ".subflow-heading",
      deletable: !!flow,
      ariaLabel: `${name} ${flow ? "컨테이너" : "그룹"}`,
    }
  })
  return [...groups, ...tasks.filter((node) => !isContainerId(map, node.id))]
}
export function outputHandle(source: Source, spec: Spec | undefined, task?: Instance): string {
  // Value and pset outputs are named by their handle.
  if (isValueSource(source) && source.kind !== "files") return source.outputRole!
  // A container's item, lanes and results are its own ports.
  if (isFlowSpec(spec) && source.kind !== "files" && source.outputRole) return "output:" + source.outputRole
  if (source.kind !== "files" && source.partition)
    return memberHandle(outputHandle({ ...source, partition: undefined }, spec, task), source.partition.value)
  if (source.kind === "files") return "output"
  const primary = primaryOutputRole(spec, task)
  if (primary && source.outputRole === primary && (!source.port || source.port === "output:" + primary)) return "output"
  if (source.port && !source.port.startsWith("output-group:")) return source.port
  if (source.group) return "output"
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
          // Edges out of a file source can be hidden (view.hideFileEdges).
          fromFiles: isSourceNode(catalog.tasks.find((s) => s.name === source.task)),
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
    checkContainerConnection(map, drawn)
    return connectValue(map, catalog, drawn, replacingId)
  }
  const connection = memberConnection(map, drawn)
  checkContainerConnection(map, connection)
  const sourceTask=map.tasks.find(t=>t.id===connection.source)
  // `<bundle>~<value>` picks one member of a partitioned port.
  const member=parseMemberHandle(connection.sourceHandle)
  const memberPort=member&&sourceTask?.outputPorts?.find(p=>p.partition&&customPortHandle(p.id)===member.base)
  const customPort=memberPort||sourceTask?.outputPorts?.find(p=>customPortHandle(p.id)===connection.sourceHandle)
  const sourcePort=memberPort?undefined:parsePort(connection.sourceHandle,"output")
  if (!(customPort || sourcePort || connection.sourceHandle === "output" || connection.sourceHandle?.startsWith("output:")) || !connection.targetHandle)
    throw Error("출력과 입력 포트를 선택해 주세요.")
  const base = replacingId
    ? {
        ...map,
        connections: map.connections.filter((c) => c.id !== replacingId),
      }
    : map
  // Keep a frozen result version when only the target of an existing edge changes.
  const prior = map.connections.find((c) => c.id === replacingId)
  const outputRole=customPort ? customPort.outputRole : sourcePort ? (sourcePort.role === "$primary" ? undefined : sourcePort.role) : connection.sourceHandle?.startsWith("output:") ? connection.sourceHandle.slice(7) : primaryOutputRole(catalog.tasks.find(s=>s.name===sourceTask?.task),sourceTask)
  const source =
    prior &&
    prior.source.kind !== "files" &&
    prior.source.taskId === connection.source &&
    outputHandle(prior.source,catalog.tasks.find(s=>s.name===sourceTask?.task),sourceTask) === connection.sourceHandle &&
    prior.source.outputRole === outputRole && JSON.stringify(prior.source.group) === JSON.stringify(sourcePort?.group)
      ? prior.source
      : customPort ? customOutput(base,connection.source,customPort,undefined,memberPort?member!.value:undefined) : nodeOutput(base, connection.source, outputRole,sourcePort?.group)
  // A container collects any number of member outputs.
  if (connection.targetHandle === COLLECT_PORT && isContainerId(map, connection.target))
    return connectCollect(base, connection.target, source)
  return connectInputPort(base,catalog,rows,connection.target,connection.targetHandle,source,true)
}
/** Replace just one partition, retaining the other inputs and their provenance. */
export function connectInputPort(map:TaskMap,catalog:Catalog,rows:Frame[],targetId:string,handle:string,incoming:Source,append=false):TaskMap {
 const target=map.tasks.find(t=>t.id===targetId)
 if(!target)throw Error('대상 작업이 없습니다.')
 const parsed=parsePort(handle,'input'),roleName=parsed?.role||handle
 const group=parsed?.group||targetGroupFor(target,roleName,incoming)
 const all=[...rows,...map.runs.flatMap(r=>r.products)]
 const source=group && !(incoming.kind==='files'&&!incoming.ids.length)?sourceForGroup(incoming,group,all):incoming
 if(!(source.kind==='files'&&!source.ids.length) && !connectionChoices(map,catalog,source,targetId,rows,roleName).some(s=>s.name===roleName))throw Error('이 입력에는 연결할 수 없습니다.')
 const spec=catalog.tasks.find(s=>s.name===target.task)!
 const multiple=spec.inputs.find(s=>s.name===roleName)?.multiple ?? catalog.ccdproc.inputs.find(s=>s.name===roleName)?.multiple ?? false
 if(group&&append&&multiple){
  const ids=target.draft.inputs[roleName]||target.preprocess.inputs[roleName]||[]
  const base=ids.length?connect(map,targetId,roleName,{kind:'files',ids,label:roleName},true):map
  return connect(base,targetId,roleName,source,true,group)
 }
 if(!group)return connect(map,targetId,roleName,source,multiple || target.task==='ccdproc'&&['zero','dark','flat'].includes(roleName))
 const keep=(ids:string[])=>ids.filter(id=>{const frame=all.find(r=>r.id===id);return !frame||!matchesGroup(frame,group)})
 const otherGroups=inputPorts(map,target,catalog,rows).filter(p=>p.role===roleName&&p.group&&!groupEqual(p.group,group)).map(p=>p.group!)
 const connections=map.connections.flatMap(c=>{
  if(c.target!==targetId||c.role!==roleName)return [c]
  if(c.targetGroup)return groupEqual(c.targetGroup,group)?[]:[c]
  if(c.source.kind==='pending')return otherGroups.map(g=>({...c,id:crypto.randomUUID(),source:sourceForGroup(c.source,g,all),targetGroup:g}))
  const ids=keep(c.source.ids)
  return ids.length?[{...c,source:{...c.source,ids}}]:[]
 })
 const draftIds=target.draft.inputs[roleName]||target.preprocess.inputs[roleName]||[]
 const remaining=keep(draftIds)
 if(remaining.length)connections.push({id:crypto.randomUUID(),target:targetId,role:roleName,source:{kind:'files',ids:remaining,label:roleName}})
 const base={...map,connections}
 return connect(base,targetId,roleName,source,true,group)

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
  const subflows = map.subflows?.map((g) => {
    const node = nodes.find((n) => n.id === g.id)!
    const resize = relevant.find(
      (c) => c.type === "dimensions" && c.id === g.id
    )
    return {
      ...g,
      position: moved.has(g.id) ? node.position : g.position,
      ...(resize?.type === "dimensions" && resize.dimensions
        ? resize.dimensions
        : {}),
    }
  })
  return {
    ...map,
    subflows,
    tasks: map.tasks.map((task) => {
      const node = nodes.find((n) => n.id === task.id)!
      const parent = subflows?.find((g) => g.id === task.subflowId)
      if (!moved.has(task.id) && !(parent && moved.has(parent.id))) return task
      return {
        ...task,
        position: parent
          ? {
              x: parent.position.x + node.position.x,
              y: parent.position.y + node.position.y,
            }
          : node.position,
      }
    }),
    view: {
      ...map.view,
      selected:
        nodes.find((n) => (n.type === "task" || isContainerId(map, n.id)) && n.selected)?.id ??
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

/** A shared output can carry several destination colors; retain each rather than choosing an arbitrary one. */
export function flowPortColors(edges: Edge[], nodeId: string, type: "source" | "target", handle: string | null | undefined): string[] {
  return [...new Set(edges.filter(edge => edge[type] === nodeId &&
    (type === "source" ? edge.sourceHandle : edge.targetHandle) === handle)
    .flatMap(edge => {
      const color = (edge.style as Record<string, unknown> | undefined)?.["--xy-edge-stroke"]
      return typeof color === "string" ? [color] : []
    }))]
}
