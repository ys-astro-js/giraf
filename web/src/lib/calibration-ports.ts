import type {Catalog,Frame,Slot,Spec} from './workbench'
import type {Instance,TaskMap,Source} from './task-map'
import {metadataMode,metadataItems,correctionRoles,correctionFlags,type MetadataMode} from './calibration'

export type CalibrationGroup={filter?:string|null;exposure?:number|null}
export type InputPort=Slot & {role:string;group?:CalibrationGroup}
export type OutputPort={name:string;kind:string;default:string;label?:string;handleId:string;outputRole?:string;group?:CalibrationGroup}
export const portHandle=(direction:'input'|'output',role:string,group:CalibrationGroup)=>`${direction}-group:${encodeURIComponent(JSON.stringify({role,group}))}`
export function parsePort(handle:string|null|undefined,direction:'input'|'output'):{role:string;group:CalibrationGroup}|undefined {
 if(!handle?.startsWith(direction+'-group:'))return undefined
 try {
  const value=JSON.parse(decodeURIComponent(handle.slice(direction.length+7)))
  if(typeof value.role!=='string'||!value.group||Object.keys(value.group).some(k=>!['filter','exposure'].includes(k)))return undefined
  return value
 } catch {return undefined}
}
export function matchesGroup(raw:Frame,group:CalibrationGroup):boolean {
 const row=raw
 return (!('filter' in group)||(row.filter?.trim()||null)===group.filter) && (!('exposure' in group)||(group.exposure===null ? row.exposure===undefined||row.exposure<0 : typeof row.exposure==='number'&&Math.abs(row.exposure-group.exposure!)<=1e-6))
}
export const groupEqual=(a:CalibrationGroup|undefined,b:CalibrationGroup|undefined)=>JSON.stringify(a||{})===JSON.stringify(b||{})
export function compactPortLabel(group:CalibrationGroup):string {
 const filter=group.filter??''
 const exposure=group.exposure==null?'':String(group.exposure)
 return filter&&exposure?filter+exposure:filter|| (exposure?exposure+'s':'?')
}
export function groupLabel(group:CalibrationGroup) {
 return [group.filter===undefined?'':group.filter||'Filter 미확인',group.exposure===undefined?'':group.exposure===null?'Exposure time 미확인':`${group.exposure} s`].filter(Boolean).join(' ')
}
const forMode=(group:CalibrationGroup,mode:MetadataMode):CalibrationGroup=>mode==='dark'?{exposure:group.exposure??null}:mode==='flat'?{filter:group.filter??null}:group
function groups(frames:Frame[],mode:MetadataMode):CalibrationGroup[] {
 return metadataItems(frames.map(row=>({...row,calibrationMetadata:undefined})),mode).map(g=>mode==='dark'?{exposure:g.exposure??null}:mode==='flat'?{filter:g.filter||null}:{filter:g.filter||null,exposure:g.exposure??null})
}
/** Resolve known input metadata through unexecuted nodes without pretending it is a result. */
export function portFrames(map:TaskMap,task:Instance,role:string,catalog:Catalog,rows:Frame[],seen=new Set<string>()):Frame[] {
 const key=task.id+':'+role
 if(seen.has(key))return []
 const visited=new Set(seen).add(key),all=[...rows,...map.runs.flatMap(r=>r.products)]
 const links=map.connections.filter(c=>c.target===task.id&&c.role===role)
 if(!links.length)return (task.draft.inputs[role]||task.preprocess.inputs[role]||[]).map(id=>all.find(r=>r.id===id)).filter((r):r is Frame=>!!r&&r.asset!=='image-list')
 return links.flatMap(c=>{
  if(c.source.kind!=='pending')return c.source.ids.map(id=>all.find(r=>r.id===id)).filter((r):r is Frame=>!!r&&r.asset!=='image-list')
  const source=c.source
  const parent=map.tasks.find(t=>t.id===source.taskId),spec=catalog.tasks.find(s=>s.name===parent?.task)
  if(!parent||!spec)return []
  const frames=portFrames(map,parent,spec.inputs[0]?.name||'input',catalog,rows,visited)
  return c.source.group?frames.filter(r=>matchesGroup(r,c.source.group!)):frames
 })
}
export function inputPorts(map:TaskMap,task:Instance,catalog:Catalog,rows:Frame[]):InputPort[] {
 const spec=catalog.tasks.find(s=>s.name===task.task)
 if(!spec)return []
 const slots=[...spec.inputs,...(spec.preprocess?catalog.ccdproc.inputs.filter(s=>!spec.inputs.some(i=>i.name===s.name)):[])]
 const main=portFrames(map,task,spec.inputs[0]?.name||'input',catalog,rows)
 return slots.filter(slot=>!(slot.name in correctionFlags) || correctionRoles(task.task).includes(slot.name)).flatMap(slot=>{
  const base={...slot,role:slot.name}
  const mode=metadataMode(task.task,slot.name)
  if(!mode||mode==='zero')return [base]
  const mainRole=slot.name===spec.inputs[0]?.name
  const partitionMain=task.task==='darkcombine'&&task.draft.calibration?.group==='exposure'||task.task==='flatcombine'&&task.draft.parameters.subsets==='yes'
  const auto=task.draft.calibration?.matching==='metadata'
  const connectedGroups=map.connections.filter(c=>c.target===task.id&&c.role===slot.name&&c.targetGroup)
  if(mainRole&&!partitionMain||!mainRole&&!auto&&!connectedGroups.length)return [base]
  const known=groups(mainRole?main:main.length?main:portFrames(map,task,slot.name,catalog,rows),mode)
  for(const c of map.connections.filter(c=>c.target===task.id&&c.role===slot.name&&c.targetGroup))if(!known.some(g=>groupEqual(g,c.targetGroup)))known.push(c.targetGroup!)
  if(!known.length)return [base]
  const ports=known.map(group=>({...base,name:portHandle('input',slot.name,group),group,multiple:true}))
  return [base,...ports]
 })
}
export function activeOutputSlots(task:Instance,spec:Spec,map?:TaskMap) {
 return (spec.outputs || []).filter(slot=>!slot.optional || !!task.draft.outputs?.[slot.name]?.trim() ||
  map?.connections.some(c=>c.source.kind!=='files' && c.source.taskId===task.id &&
   (c.source.outputRole===slot.name || c.source.port==='output:'+slot.name)))
}
export function primaryOutputRole(spec:Spec|undefined) {
 return spec?.adapter==='generic' ? (spec.outputs?.find(slot=>!slot.optional) || spec.outputs?.[0])?.name : undefined
}
export function outputPorts(map:TaskMap,task:Instance,catalog:Catalog,rows:Frame[]):OutputPort[] {
 const spec=catalog.tasks.find(s=>s.name===task.task)
 if(!spec)return []
 const mode=metadataMode(task.task,spec.inputs[0]?.name||'input')
 const split=task.task==='ccdproc'||task.task==='darkcombine'&&task.draft.calibration?.group==='exposure'||task.task==='flatcombine'&&task.draft.parameters.subsets==='yes'
 const outputRole=spec.adapter==='generic'?spec.outputs?.find(s=>s.kind==='image')?.name:undefined
 if(mode&&mode!=='zero'&&split){
  const known=groups(portFrames(map,task,spec.inputs[0]?.name||'input',catalog,rows),mode)
  for(const c of map.connections)if(c.source.kind!=='files'&&c.source.taskId===task.id&&c.source.port&&c.source.group&&!known.some(g=>groupEqual(g,c.source.group)))known.push(c.source.group)
  if(known.length)return known.map(group=>({name:groupLabel(group),kind:'image',default:'',group,outputRole,handleId:portHandle('output',outputRole||'$primary',group)}))
 }
 return (spec.outputs?.length||0)>1?activeOutputSlots(task,spec,map).filter(s=>s.name!==primaryOutputRole(spec)).map(s=>({...s,outputRole:s.name,handleId:'output:'+s.name})):[]
}
export function sourceForGroup(source:Source,group:CalibrationGroup,rows:Frame[]):Source {
 if(source.group && Object.keys(group).some(k=>!(k in source.group!) || source.group![k as keyof CalibrationGroup]!==group[k as keyof CalibrationGroup]))throw Error('서로 다른 Filter 또는 Exposure time 포트는 연결할 수 없습니다.')
 const selector={...source.group,...group}
 if(source.kind==='pending')return {...source,group:selector}
 const ids=source.ids.filter(id=>{const row=rows.find(r=>r.id===id);return row&&(row.asset==='image-list'||matchesGroup(row,selector))})
 if(!ids.length)throw Error('이 포트에 해당하는 영상이 없습니다.')
 return {...source,ids,group:selector}
}
export function targetGroupFor(task:Instance,role:string,source:Source):CalibrationGroup|undefined {
 const mode=metadataMode(task.task,role)
 return mode&&mode!=='zero'&&source.group?forMode(source.group,mode):undefined
}
