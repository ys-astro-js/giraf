import {customPortHandle,customOutput,outputPorts,primaryOutputRole} from "./output-ports"
import {correctionFlags,correctionRoles} from "./calibration"
import { latestRun } from "./task-map/runs"
import {
  connectionRoles,
  layoutMap,
  type Instance,
  type Source,
  type TaskMap,
} from "@/lib/task-map"
import { acceptsAsset, acceptsSource, type Catalog, type Frame, type Slot } from "./workbench"
import { closesCycle, isContainerId } from "./flow-graph"
import { isValueNode, pinnedKeys, psetLinksInto, psetOutputName, valueOutputs, PARAM_HANDLE, PSET_INPUT, PSET_OUTPUT, VALUE_HANDLE } from "./values"

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
export function nodeOutput(map: TaskMap, id: string, outputRole?: string): Source {
  const configured = map.tasks.find(t=>t.id===id)?.outputPorts?.find(p=>p.id===(outputRole?'$role:'+outputRole:'$default'))
  if(configured) return customOutput(map,id,configured)
  const run = latestRun(map, id)
  if (!run || run.state !== "completed") return { kind: "pending", taskId: id, ...(outputRole ? {outputRole} : {}) }
  const products = run.products.filter(p => p.role !== "$log")
  const kind = products.some(p => (p.asset || "image") === "image")
    ? "image" : products[0]?.asset || "text"
  const ids = products.filter(p => outputRole
    ? p.role === outputRole : (p.asset || "image") === kind).map(p => p.id)
  return ids.length
    ? { kind: "result", taskId: id, runId: run.id, ids, ...(outputRole ? {outputRole} : {}) }
    : { kind: "pending", taskId: id, ...(outputRole ? {outputRole} : {}) }
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
    if (closesCycle(map, parent, source.kind !== "files" ? source.outputRole : undefined, target, targetRole))
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
  // A pass output carries whatever its input holds; the run checks each file.
  const fits = (slotKind: string, kind: string) => kind === "any" || acceptsAsset(slotKind, kind)
  const inputs = connectionRoles(spec, catalog)
  if (targetRole) {
    const slot = inputs.find(s => s.name === targetRole && acceptsSource(s, "node"))
    if (!slot) throw Error("입력 포트를 찾을 수 없습니다.")
    if (!roleActive(t, slot.name, catalog))
      throw Error(`${slot.name} 입력이 비활성 상태입니다. 설정에서 켜 주세요.`)
    const compatible = source.kind === "pending"
      ? kinds.some(k => fits(slot.kind, k))
      : kinds.every(k => acceptsAsset(slot.kind, k))
    if (!compatible)
      throw Error(`${slot.name}에는 ${slot.kind} 자료가 필요합니다. 이 출력은 ${kinds.join(", ")} 형식입니다.`)
    if (!slot.multiple && count !== 1)
      throw Error(`${slot.name}에는 파일 1개만 연결할 수 있습니다. 현재 출력은 ${count}개입니다.`)
  }
  const roles = inputs.filter(
    (s) =>
      acceptsSource(s, "node") &&
      roleActive(t, s.name, catalog) &&
      (source.kind === "pending" ? kinds.some(k => fits(s.kind, k)) : kinds.every((k) => acceptsAsset(s.kind, k))) &&
      (s.multiple || count === 1)
  )
  if (!roles.length)
    throw Error(
      "연결 가능한 입력이 없습니다. 출력 종류와 파일 개수, 목표 작업의 활성 입력을 확인해 주세요."
    )
  return roles
}
export const NODE_WIDTH = 264
export const COLLAPSED_WIDTH = 184
export const COLLAPSED_HEIGHT = 40
/** Vertical metrics shared by the node markup, handles, ELK ports and fitting. */
export const NODE_METRICS = { header: 52, row: 32, member: 28, sectionStart: 5, sectionEnd: 4, preview: 77 }
/** The latest completed run's images, newest first; the node previews a few. */
export function nodePreviewIds(map: TaskMap, id: string) {
  const run = latestRun(map, id)
  if (!run || run.state !== "completed") return []
  return run.products.filter((p) => p.role !== "$log" && (p.asset || "image") === "image").map((p) => p.id)
}
/** A task's input rows: its inputs, and the ccdproc corrections its preprocessing uses. */
export function inputSlots(t: Instance, catalog: Catalog) {
  const spec = catalog.tasks.find((s) => s.name === t.task)
  if (!spec) return []
  return connectionRoles(spec, catalog)
    .filter((slot) => !(slot.name in correctionFlags) || correctionRoles(t.task).includes(slot.name))
    .map((slot) => ({ ...slot, role: slot.name }))
}
export function nodeGeometry(map: TaskMap, t: Instance, catalog: Catalog, rows:Frame[] = [], collapsed = !!t.collapsed) {
  void rows
  const spec = catalog.tasks.find((s) => s.name === t.task)
  const roles = inputSlots(t, catalog).filter(
    (s) => (
      roleActive(t, s.role, catalog) ||
      map.connections.some((c) => c.target === t.id && c.role === s.role) ||
      t.expressions[s.role] ||
      t.draft.inputs[s.role]?.length ||
      t.preprocess.inputs[s.role]?.length)
  )
  const outputs = [...outputPorts(map,t,catalog).map(slot=>({...slot,name:t.outputPorts?.find(p=>customPortHandle(p.id)===slot.handleId)?.name ?? slot.name})), ...(t.outputPorts || []).filter(p=>!p.id.startsWith('$')).map(port=>({name:port.name,kind:"",default:"",handleId:customPortHandle(port.id),outputRole:port.outputRole,customId:port.id}))]
  // A save-files node (node schema) ends the flow: it has no primary output.
  // Value and pset nodes only carry values, so they have no file output either.
  const valueNode = isValueNode(spec)
  const primary = spec?.run !== "save-files" && !valueNode
  const showInputs = !valueNode || roles.length > 0
  // Parameters shown on the node: psets fed by a pset node, then pinned parameters.
  const params = [
    ...psetLinksInto(map, t.id).map((c) => ({ key: c.role.slice(PSET_INPUT.length), handleId: c.role, pset: true })),
    ...(spec ? pinnedKeys(map, catalog, t) : []).map((key) => ({ key, handleId: PARAM_HANDLE + key, pset: false })),
  ]
  const psetOutput = spec?.run === "pset"
  // A pset node's parameter takes a value on the left and offers it on the right of one row.
  const values = valueOutputs(spec, t, catalog).map((o) => {
    const row = psetOutput ? params.find((p) => psetOutputName(t, p.key) === o.name) : undefined
    return { ...o, handleId: VALUE_HANDLE + o.name, param: row?.handleId }
  })
  const base = { primaryOutputRole: primaryOutputRole(spec, t), roles, primary, collapsed, showInputs, psetOutput }
  if (collapsed) {
    const middle = COLLAPSED_HEIGHT / 2
    return {
      ...base,
      preview: false,
      width: COLLAPSED_WIDTH,
      outputX: COLLAPSED_WIDTH,
      height: COLLAPSED_HEIGHT,
      occupiedHeight: COLLAPSED_HEIGHT,
      outputY: middle,
      outputs: outputs.map((slot) => ({ ...slot, x: COLLAPSED_WIDTH, y: middle })),
      params: params.map((row) => ({ ...row, y: middle })),
      values: values.map((row) => ({ ...row, x: COLLAPSED_WIDTH, y: middle })),
      psetOutputY: middle,
      // Every role shares the capsule's single visible port.
      inputY: (role: string) => {
        void role
        return middle
      },
    }
  }
  const m = NODE_METRICS
  // The 1px node border precedes the header.
  const inputsTop = 1 + m.header + m.sectionStart
  const inputsEnd = showInputs ? inputsTop + m.row * Math.max(roles.length, 1) + m.sectionEnd : 1 + m.header
  // Pinned parameters sit between inputs and outputs.
  const paramsTop = inputsEnd + m.sectionStart
  const paramsEnd = params.length ? paramsTop + m.row * params.length + m.sectionEnd : inputsEnd
  const outputRows = [...(primary ? ["output"] : []), ...outputs.map(slot => slot.handleId), ...values.filter(row => !row.param).map(row => row.handleId), ...(psetOutput ? [PSET_OUTPUT] : [])]
  const outputsTop = paramsEnd + m.sectionStart
  // Each row's top.
  const tops: Record<string, number> = {}
  let bottom = outputsTop
  for (const handleId of outputRows) {
    tops[handleId] = bottom
    bottom += m.row
  }
  const outputsEnd = outputRows.length ? bottom + m.sectionEnd : paramsEnd
  const preview = nodePreviewIds(map, t.id).length > 0
  const height = outputsEnd + (preview ? m.preview : 0) + 1
  const outputY = outputsTop + m.row / 2
  const rowY = (handleId: string) => tops[handleId] + m.row / 2
  const paramY = (index: number) => paramsTop + m.row / 2 + m.row * index
  return {
    ...base,
    preview,
    width: NODE_WIDTH,
    outputX: NODE_WIDTH,
    height,
    occupiedHeight: height,
    outputY,
    outputs: outputs.map((slot) => ({ ...slot, x: NODE_WIDTH, y: rowY(slot.handleId) })),
    params: params.map((row, index) => ({ ...row, y: paramY(index) })),
    values: values.map((row) => ({ ...row, x: NODE_WIDTH, y: row.param ? paramY(params.findIndex((p) => p.handleId === row.param)) : rowY(row.handleId) })),
    psetOutputY: psetOutput ? rowY(PSET_OUTPUT) : 0,
    inputY: (role: string) => inputsTop + m.row / 2 + m.row * Math.max(0, roles.findIndex((slot) => slot.name === role)),
  }
}
/** `collapseAll` draws every node collapsed (a zoomed-out canvas) without changing the map. */
export function nodeLayout(map: TaskMap, catalog: Catalog, rows:Frame[] = [], collapseAll = false) {
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
  const containers = (map.subflows ?? []).filter((g) => isContainerId(map, g.id)).map((g) => ({
    ...g.position, width: g.width, occupiedHeight: g.collapsed ? COLLAPSED_HEIGHT : g.height,
  }))
  return map.tasks.map((t) => {
    const level = base.find((p) => p.id === t.id)!,
      g = nodeGeometry(map, t, catalog, rows, collapseAll || !!t.collapsed),
      y = bottoms.get(level.x) || 32
    // A container is drawn by its group; its task takes no place of its own.
    const container = isContainerId(map, t.id) ? map.subflows!.find((group) => group.id === t.id)! : undefined
    if (container) return { id: t.id, ...g, x: container.position.x, y: container.position.y, width: 0, height: 0, occupiedHeight: 0 }
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
    // A new node also stays clear of containers, which have no task node of their own.
    const blocked = t.position ? placed : [...placed, ...containers]
    let overlap
    do {
      overlap = blocked.find(
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
