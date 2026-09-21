import {headerFrame} from "./calibration"
export type Values = Record<string, string | number | boolean | null>
export type Param = { mode?:string; required?:boolean; indirect?:string; name:string; type:string; default:string | number | boolean | null; choices:string[]; prompt:string; min:unknown; max:unknown }
export type Slot = { valueType?:string; cursorType?:string; representation?:string; name:string; label:string; multiple:boolean; required?:boolean; kind:string }
export type OutputSlot = { eachWhen?:string; optional?:boolean; name:string; kind:string; default:string; mode?:string; label?:string }
export type ParameterSet = { name:string; task:string; parameters:Param[] }
export type Spec = { executor?:'image-list'; taskName?:string; adapter?:'generic'; runnable?:boolean; reason?:string; description?:string; outputs?:OutputSlot[]; parameterSets?:ParameterSet[]; name:string; title:string; package:string; parameters:Param[]; inputs:Slot[]; output:{ name:string; mode:string; default:string } | null; kind:string; preprocess?:boolean }
export type Catalog = { version:string; tasks:Spec[]; ccdproc:{parameters:Param[];inputs:Slot[]}; ccdred:Param[]; exam:Record<string,Param[]>; capabilities?:{version:string;schemaFingerprint:string;fallback:string[];limits:Record<string,string>} }
export type Frame = { calibrationMetadata?:{filter:string;exposure:number}; role?:string; id:string; label:string; path?:string; name?:string; asset?:string; filter?:string; exposure?:number; shape?:string; width?:number; height?:number; detected_kind?:string; group?:string; job?:string; error?:string; history?:Record<string,string>;source?:string;viewer_supported?:boolean }
export type AlignmentBinding = {reference:string[];input:string[]}
export type Draft = { calibration?:import("./calibration").CalibrationOptions; textInputs?:Record<string,string>; alignmentBinding?:AlignmentBinding; cursorCommands?:Record<string,string>; outputs?:Record<string,string>; parameters:Values; inputs:Record<string,string[]>; output:{name:string}; section:string; exam:{x:number|null;y:number|null;key:string;parameters:Record<string,Values>} }
export type WorkflowDocument = {path: string; name: string; saved?: boolean}
export type Preferences = { _document?:WorkflowDocument; parameterSets?:Record<string,Record<string,Values>>; drafts:Record<string,Draft>; backend:string; mapping:Values; instrument:string[]; packageValues:Values; taskMap?:import('./task-map').TaskMap }
export type Workspace = { folder:string; files:Frame[]; sets:{name:string;ids:string[];folder:string}[] }
export type Manifest = { workflowId?:string; workflowStep?:number; textInputs?:Record<string,string>; alignmentBinding?:AlignmentBinding; inputSelections?:Record<string,string[]>; cursorCommands?:Record<string,string>; outputs?:Record<string,string>; parameterSets?:Record<string,Values>; task:string; backend:string; parameters:Values; inputs:Record<string,string[]>; output:{name:string}; ccdproc:Values; ccdred:Values; mapping:Values; section:string; exam:Draft['exam']; rows:Frame[] }
export type Job = {execution?:{id:string;step:number}|null;id:string;name:string;task?:string;backend?:string;state:string;message:string;count:number;progress:number;products:Frame[];manifest?:Manifest & {instanceId?:string};log?:string;commands?:string;operation?:string;outcomes?:{source:string;label:string;state:string;message:string}[];headerDiff?:{source:string;key:string;before:string|null;after:string|null}[];effective?:unknown;interaction?:{id:string;kind:string;prompt:string;state:string;wcs?:number[][];initial?:string}}
export const defaults=(params:Param[]):Values=>Object.fromEntries(params.map(p=>[p.name,p.default]))
export function makeDraft(spec:Spec | undefined, saved?:Partial<Draft>):Draft {
  const parameters = {...defaults(spec?.parameters || []), ...saved?.parameters}
  if (spec?.adapter === 'generic') for (const name of Object.keys(parameters)) {
    if (!spec.parameters.some(p => p.name === name)) delete parameters[name]
  }
  const outputs = {...Object.fromEntries((spec?.outputs || []).map(s => [s.name, !saved && spec?.name === 'ccdproc' && s.name === 'output' ? 'p_' : s.default])), ...saved?.outputs}
  if (spec?.adapter === 'generic' && !saved?.outputs && saved?.output?.name && spec.outputs?.length === 1) {
    outputs[spec.outputs[0].name] = saved.output.name
  }
  return {calibration:undefined,textInputs:{...saved?.textInputs},alignmentBinding:saved?.alignmentBinding,cursorCommands:{...saved?.cursorCommands},outputs,parameters,inputs:{...saved?.inputs},output:{name:spec?.output?.default||'',...saved?.output},section:saved?.section||'',exam:{x:null,y:null,key:'r',parameters:{},...saved?.exam}}
}
export function buildPayload(task:Spec,drafts:Record<string,Draft>,catalog:Catalog,prefs:Omit<Preferences,'drafts'>){
  const d=makeDraft(task,drafts[task.name]),proc=makeDraft(catalog.tasks.find(t=>t.name==='ccdproc')!,drafts.ccdproc)
  const inputs={...d.inputs}
  if(task.adapter!=='generic'&&task.preprocess)for(const slot of catalog.ccdproc.inputs)inputs[slot.name]=proc.inputs[slot.name]||[]
  if(task.adapter!=='generic')inputs.instrument=prefs.instrument
  return {calibration:undefined,task:task.name,backend:prefs.backend,outputs:d.outputs||{},textInputs:d.textInputs||{},alignmentBinding:d.alignmentBinding,cursorCommands:d.cursorCommands||{},parameterSets:prefs.parameterSets?.[task.name]||{},inputs,parameters:d.parameters,output:d.output,ccdproc:proc.parameters,ccdred:prefs.packageValues,mapping:prefs.mapping,section:d.section,exam:d.exam}
}
export function mergeInputs(previous:string[],incoming:string[],multiple:boolean,append:boolean){
  return multiple?[...new Set([...(append?previous:[]),...incoming])]:incoming.slice(0,1)
}
export function plannedOutputs(task:Spec,draft:Draft,rows:Frame[],_mapping:Values={}):{input:string;output:string}[]{
  if(task.adapter==='generic'){
    const ids=draft.inputs[task.inputs[0]?.name]||[]
    const outputs=(task.outputs||[]).flatMap(slot=>{
      const value=draft.outputs?.[slot.name]??slot.default
      if(slot.optional&&!value)return []
      const each = slot.eachWhen ? draft.parameters[slot.eachWhen] === 'yes' : slot.mode === 'each'
      return each?ids.map(id=>{const row=rows.find(r=>r.id===id),stem=(row?.name||row?.label||id).replace(/\.[^.]*$/, '');return {input:row?.label||id,output:value+stem+({image:'.fits',mask:'.pl',text:'.txt',metacode:'.gki',binary:'.bin','image-list':'.list'}[slot.kind]||'')}}):[{input:task.taskName||task.name,output:value}]
    })
    return outputs.length?outputs:[{input:task.taskName||task.name,output:'실행 로그'}]
  }
  if(!task.output||draft.parameters.noproc==='yes')return [{input:task.name,output:'task.log'}]
  const ids=draft.inputs[task.inputs[0].name]||[],name=draft.output.name
  if(!ids.length)return []
  const selected=ids.map(id=>headerFrame(rows.find(f=>f.id===id)||{id,label:id}))
  if(['each','edit'].includes(task.output.mode)){
    const counts:Record<string,number>={}
    return selected.map(row=>{let output=name+row.label;counts[output]=(counts[output]||0)+1;if(counts[output]>1)output=output.replace(/(\.[^.]*)?$/,`_${counts[output]}$1`);return {input:row.label,output}})
  }
  if(draft.parameters.subsets==='yes')return [...new Set(selected.map(f=>f.filter||''))].map(filter=>({input:`${filter||'Subset 없음'} 영상 ${selected.filter(f=>(f.filter||'')===filter).length}개`,output:name.replace(/\.fits$/i,'')+filter+'.fits'}))
  return [{input:`${ids.length}개`,output:name}]
}
export async function api<T>(action:string,payload?:unknown):Promise<T>{
  const response=await fetch('/api/'+action,payload===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)})
  const data=await response.json()
  if(!response.ok)throw new Error(data.error||data.errors?.join('\n')||'요청 실패')
  return data
}
export const primaryParameters=new Set(['combine', 'reject', 'ccdtype', 'process', 'subsets', 'scale', 'statsec', 'rdnoise', 'gain', 'zerocor', 'darkcor', 'flatcor', 'fixpix', 'overscan', 'trim', 'illumcor', 'fringecor', 'readcor', 'scancor', 'noproc', 'parameter', 'value', 'type', 'longheader', 'fields', 'nlow', 'nhigh', 'pixeltype', 'verbose', 'biassec', 'trimsec', 'names', 'long', 'group', 'ncstat', 'nlstat'])

export function taskDisplayName(identity: string): string {
  return identity.split('.').at(-1) || identity
}

export function acceptsAsset(kind: string, asset: string | undefined): boolean {
  return kind === asset || asset === 'image-list' && (kind === 'image' || kind === 'text')
}
