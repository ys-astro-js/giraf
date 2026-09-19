import {customOutput, customPortHandle} from "./output-ports"
import {parsePort,sourceForGroup,targetGroupFor,matchesGroup,groupEqual,inputPorts} from "./calibration-ports"
import {
  applyNodeChanges,
  Position,
  type Connection as FlowConnection,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react"
import { connect, type Instance, type TaskMap, type Subflow, type Source } from "./task-map"
import {
  connectionChoices,
  nodeGeometry,
  nodeLayout,
  nodeOutput,
  roleActive,
} from "./node-interaction"
import type { Catalog, Frame } from "./workbench"

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
export type WorkflowNode = TaskFlowNode | SubflowNode
const matches = (task: Instance, search: string) =>
  `${task.task} ${task.label}`.toLowerCase().includes(search.toLowerCase())

export function flowNodes(
  map: TaskMap,
  catalog: Catalog,
  search = "",
  rows:Frame[] = []
): WorkflowNode[] {
  const layout = nodeLayout(map, catalog,rows)
  const tasks: TaskFlowNode[] = map.tasks.map((task, i) => {
    const parent = map.subflows?.find((g) => g.id === task.subflowId)
    const absolute = task.position ?? { x: layout[i].x, y: layout[i].y }
    const geometry = layout[i]
    return {
      id: task.id,
      type: "task",
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

      initialWidth: geometry.width,
      initialHeight: geometry.height,
      style: { width: geometry.width },
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
      ],
      selected: map.view.selected === task.id,
      hidden: !matches(task, search),
      dragHandle: ".node-heading",
      ariaLabel: `${task.label} 작업`,
    }
  })
  const groups: SubflowNode[] = (map.subflows ?? []).map((group) => {
    const children = tasks.filter((t) => t.parentId === group.id)
    const minWidth = Math.max(
      360,
      ...children.map((t) => t.position.x + (t.initialWidth ?? 248) + 24)
    )
    const minHeight = Math.max(
      160,
      ...children.map((t) => t.position.y + t.data.geometry.occupiedHeight + 24)
    )
    return {
      id: group.id,
      type: "subflow",
      data: { group, count: children.length, minWidth, minHeight },
      position: group.position,
      style: {
        width: group.width,
        height: group.height,
      },
      initialWidth: group.width,
      initialHeight: group.height,
      hidden: children.length ? children.every((t) => t.hidden) : !!search,
      dragHandle: ".subflow-heading",
      deletable: false,
      ariaLabel: `${group.name} 그룹`,
    }
  })
  return [...groups, ...tasks]
}
export function flowEdges(map: TaskMap, catalog: Catalog, search = ""): Edge[] {
  return map.connections.flatMap((connection) => {
    const sourceId =
      connection.source.kind !== "files" ? connection.source.taskId : undefined
    const source = map.tasks.find((t) => t.id === sourceId)
    const target = map.tasks.find((t) => t.id === connection.target)
    // File inputs and results whose source was deleted are still shown in the input summary.
    if (!source || !target) return []
    return [
      {
        id: connection.id,
        source: source.id,
        target: target.id,
        sourceHandle: connection.source.port && !connection.source.port.startsWith("output-group:") ? connection.source.port : connection.source.group ? "output" : (connection.source.kind !== "files" && connection.source.outputRole && (catalog.tasks.find(s=>s.name===source.task)?.outputs?.length || 0)>1 ? "output:" + connection.source.outputRole : "output"),
        targetHandle: connection.role,
        hidden: !matches(source, search) || !matches(target, search),
        className:
          !target.expressions[connection.role] &&
          roleActive(target, connection.role, catalog)
            ? undefined
            : "workflow-edge-inactive",
        ariaLabel: `${source.label}에서 ${target.label} ${connection.role} 연결`,
      },
    ]
  })
}
export function connectFlow(
  map: TaskMap,
  catalog: Catalog,
  rows: Frame[],
  connection: FlowConnection,
  replacingId?: string
): TaskMap {
  const customPort=map.tasks.find(t=>t.id===connection.source)?.outputPorts?.find(p=>customPortHandle(p.id)===connection.sourceHandle)
  const sourcePort=parsePort(connection.sourceHandle,"output")
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
  const outputRole=customPort ? customPort.outputRole : sourcePort ? (sourcePort.role === "$primary" ? undefined : sourcePort.role) : connection.sourceHandle?.startsWith("output:") ? connection.sourceHandle.slice(7) : undefined
  const source =
    prior &&
    prior.source.kind !== "files" &&
    prior.source.taskId === connection.source &&
    (prior.source.port || (prior.source.outputRole && (catalog.tasks.find(s=>s.name===map.tasks.find(t=>t.id===connection.source)?.task)?.outputs?.length || 0)>1 ? 'output:'+prior.source.outputRole : 'output')) === connection.sourceHandle &&
    prior.source.outputRole === outputRole && JSON.stringify(prior.source.group) === JSON.stringify(sourcePort?.group)
      ? prior.source
      : customPort ? customOutput(base,connection.source,customPort) : nodeOutput(base, connection.source, outputRole,sourcePort?.group)
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
 if(!(source.kind==='files'&&!source.ids.length) && !connectionChoices(map,catalog,source,targetId,rows).some(s=>s.name===roleName))throw Error('이 입력에는 연결할 수 없습니다.')
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
        nodes.find((n) => n.type === "task" && n.selected)?.id ??
        map.view.selected,
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
