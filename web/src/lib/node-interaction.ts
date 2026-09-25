import {customPortHandle,customOutput} from "./output-ports"
import {inputPorts,outputPorts,primaryOutputRole,matchesGroup,portHandle,type CalibrationGroup} from "./calibration-ports"
import {
  connectionRoles,
  layoutMap,
  type Instance,
  type Source,
  type TaskMap,
} from "./task-map"
import { acceptsAsset, type Catalog, type Frame, type Slot } from "./workbench"

const flags: Record<string, string> = {
  zero: "zerocor",
  dark: "darkcor",
  flat: "flatcor",
  illum: "illumcor",
  fringe: "fringecor",
  fixfile: "fixpix",
}
export function roleActive(t: Instance, role: string, catalog: Catalog) {
  if (t.task !== "ccdproc" && catalog.tasks.find(s=>s.name===t.task)?.adapter === "generic") return true
  const flag = flags[role]
  if (!flag) return true
  if (t.task === "mkskyflat" && role === "flat") return true
  const spec = catalog.tasks.find((s) => s.name === t.task)
  return !!(
    (t.task === "ccdproc" ||
      (spec?.preprocess &&
        (t.draft.parameters.process === "yes" || t.task.startsWith("mk")))) &&
    (t.task === "ccdproc" ? t.draft : t.preprocess).parameters[flag] === "yes"
  )
}
export function nodeOutput(map: TaskMap, id: string, outputRole?: string, group?:CalibrationGroup): Source {
  const configured = map.tasks.find(t=>t.id===id)?.outputPorts?.find(p=>p.id===(outputRole?'$role:'+outputRole:'$default'))
  if(configured) return customOutput(map,id,configured,group)
  const run = map.runs.filter((r) => r.instanceId === id).at(-1)
  if (!run || run.state !== "completed") return { kind: "pending", taskId: id, ...(outputRole ? {outputRole} : {}),...(group?{group,port:portHandle("output",outputRole||"$primary",group)}:{}) }
  const products = run.products.filter(p => p.role !== "$log" && (!group || matchesGroup(p,group)))
  const kind = products.some(p => (p.asset || "image") === "image")
    ? "image" : products[0]?.asset || "text"
  const ids = products.filter(p => outputRole
    ? p.role === outputRole : (p.asset || "image") === kind).map(p => p.id)
  return ids.length
    ? { kind: "result", taskId: id, runId: run.id, ids, ...(outputRole ? {outputRole} : {}),...(group?{group,port:portHandle("output",outputRole||"$primary",group)}:{}) }
    : { kind: "pending", taskId: id, ...(outputRole ? {outputRole} : {}),...(group?{group,port:portHandle("output",outputRole||"$primary",group)}:{}) }
}
export function connectionChoices(
  map: TaskMap,
  catalog: Catalog,
  source: Source,
  target: string,
  rows: Frame[],
  targetRole?: string
): Slot[] {
  const t = map.tasks.find((t) => t.id === target),
    spec = catalog.tasks.find((s) => s.name === t?.task)
  if (!t || !spec)
    throw Error("연결할 작업을 찾을 수 없습니다.")
  if (!source || !["files", "result", "pending"].includes(source.kind))
    throw Error("연결할 출력을 다시 선택해 주세요.")
  const parent = source.kind !== "files" ? source.taskId : undefined
  if (parent) {
    if (!map.tasks.some((t) => t.id === parent))
      throw Error("출력 작업이 삭제되었습니다.")
    const reaches = (id: string, seen = new Set<string>()): boolean =>
      id === parent ||
      (!seen.has(id) &&
        (seen.add(id),
        map.connections.some(
          (c) =>
            c.source.kind !== "files" &&
            c.source.taskId === id &&
            reaches(c.target, seen)
        )))
    if (reaches(target))
      throw Error(
        target === parent
          ? "자기 자신의 출력은 입력으로 연결할 수 없습니다."
          : "앞선 작업으로 연결하면 순환이 생깁니다."
      )
  }
  let kinds: string[],
    count = 1
  if (source.kind === "pending") {
    const upstream = map.tasks.find((t) => t.id === source.taskId)
    const s = catalog.tasks.find((s) => s.name === upstream?.task)
    if (!s) throw Error("출발 작업을 다시 선택해 주세요.")
    kinds = s.adapter === "generic" && s.outputs?.length
      ? [...new Set(s.outputs.filter(output=>!source.outputRole || output.name===source.outputRole).map(output=>output.kind))]
      : [s.kind]
  } else {
    if (!Array.isArray(source.ids) || !source.ids.length)
      throw Error("이 출력에는 연결할 파일이 없습니다.")
    const products = [...rows, ...map.runs.flatMap((r) => r.products)]
    const selected = source.ids.map((id) => products.find((p) => p.id === id))
    if (selected.some((p) => !p))
      throw Error(
        "출력 파일을 찾을 수 없습니다. 결과 패널에서 파일을 확인해 주세요."
      )
    kinds = [...new Set(selected.map((p) => p!.asset || "image"))]
    count = selected.length
  }
  const inputs = connectionRoles(spec, catalog)
  if (targetRole) {
    const slot = inputs.find(s => s.name === targetRole)
    if (!slot) throw Error("입력 포트를 찾을 수 없습니다.")
    if (!roleActive(t, slot.name, catalog))
      throw Error(`${slot.name} 입력이 비활성 상태입니다. 설정에서 켜 주세요.`)
    const compatible = source.kind === "pending"
      ? kinds.some(k => acceptsAsset(slot.kind, k))
      : kinds.every(k => acceptsAsset(slot.kind, k))
    if (!compatible)
      throw Error(`${slot.name}에는 ${slot.kind} 자료가 필요합니다. 이 출력은 ${kinds.join(", ")} 형식입니다.`)
    if (!slot.multiple && count !== 1)
      throw Error(`${slot.name}에는 파일 1개만 연결할 수 있습니다. 현재 출력은 ${count}개입니다.`)
  }
  const roles = inputs.filter(
    (s) =>
      roleActive(t, s.name, catalog) &&
      (source.kind === "pending" ? kinds.some(k => acceptsAsset(s.kind, k)) : kinds.every((k) => acceptsAsset(s.kind, k))) &&
      (s.multiple || count === 1)
  )
  if (!roles.length)
    throw Error(
      "연결 가능한 입력이 없습니다. 출력 종류와 파일 개수, 목표 작업의 활성 입력을 확인해 주세요."
    )
  return roles
}
export const NODE_WIDTH = 280
export function nodeGeometry(map: TaskMap, t: Instance, catalog: Catalog, rows:Frame[] = []) {
  const spec = catalog.tasks.find((s) => s.name === t.task)
  const roles = (spec ? inputPorts(map,t,catalog,rows) : []).filter(
    (s) => !s.group && (
      roleActive(t, s.role, catalog) ||
      map.connections.some((c) => c.target === t.id && c.role === s.role) ||
      t.expressions[s.role] ||
      t.draft.inputs[s.role]?.length ||
      t.preprocess.inputs[s.role]?.length)
  )
  const outputs = [...outputPorts(map,t,catalog,rows).filter(slot => !slot.group).map(slot=>({...slot,name:t.outputPorts?.find(p=>customPortHandle(p.id)===slot.handleId)?.name ?? slot.name})), ...(t.outputPorts || []).filter(p=>!p.id.startsWith('$')).map(port=>({name:port.name,kind:"",default:"",handleId:customPortHandle(port.id),outputRole:port.outputRole,group:undefined,customId:port.id}))]
  const bodyHeight=48*Math.max(roles.length,1)
  const height=Math.max(128+bodyHeight,104+outputs.length*36)
  const outputY=height-24-outputs.length*36
  return {
    primaryOutputRole:primaryOutputRole(spec),
    roles,
    bodyHeight,
    width:NODE_WIDTH,
    outputX:NODE_WIDTH,
    height,
    occupiedHeight:height,
    outputY,
    outputs:outputs.map((slot,index)=>({...slot,x:NODE_WIDTH,y:outputY+(index+1)*36})),
    inputY:(role:string)=>96+48*Math.max(0,roles.findIndex(slot=>slot.name===role)),
  }
}
export function nodeLayout(map: TaskMap, catalog: Catalog, rows:Frame[] = []) {
  const base = layoutMap({
      ...map,
      tasks: map.tasks.map((t) => ({ ...t, position: undefined })),
    }),
    bottoms = new Map<number, number>()
  const placed: (ReturnType<typeof nodeGeometry> & {
    x: number
    y: number
    id: string
  })[] = []
  return map.tasks.map((t) => {
    const level = base.find((p) => p.id === t.id)!,
      g = nodeGeometry(map, t, catalog, rows),
      y = bottoms.get(level.x) || 32
    bottoms.set(level.x, y + g.occupiedHeight + 40)
    const node = {
      id: t.id,
      ...g,
      ...(t.position || {
        x: 32 + ((level.x - 40) / 320) * (NODE_WIDTH + 112),
        y,
      }),
    }
    // Larger role cards must not collide with positions saved by the compact layout.
    let overlap
    do {
      overlap = placed.find(
        (p) =>
          node.x < p.x + p.width + 24 &&
          node.x + node.width + 24 > p.x &&
          node.y < p.y + p.occupiedHeight + 24 &&
          node.y + node.occupiedHeight + 24 > p.y
      )
      if (overlap) node.y = overlap.y + overlap.occupiedHeight + 40
    } while (overlap)
    placed.push(node)
    return node
  })
}
export function fitNodes(
  nodes: { x: number; y: number; width: number; height: number }[],
  width: number,
  height: number
) {
  const right = Math.max(1, ...nodes.map((p) => p.x + p.width)) + 24,
    bottom = Math.max(1, ...nodes.map((p) => p.y + p.height)) + 24
  return {
    zoom: Math.max(
      0.01,
      Math.min(
        1,
        Math.max(1, width - 24) / right,
        Math.max(1, height - 24) / bottom
      )
    ),
    x: 0,
    y: 0,
  }
}
