import type {Frame} from './workbench'
export type GroupKey = {filter?:string|null;exposure?:number|null}
export type GroupOverride = {group:GroupKey;parameters?:Record<string,string>;output?:string}
export type CalibrationOptions = {matching?:'metadata'|'manual';group?:'exposure'|'none';overrides?:GroupOverride[]}
export const groupOverride=(options:CalibrationOptions|undefined,group:GroupKey)=>options?.overrides?.find(o=>Object.keys(o.group).length===Object.keys(group).length && Object.entries(group).every(([k,v])=>o.group[k as keyof GroupKey]===v))
export function updateGroupOverride(options:CalibrationOptions|undefined,group:GroupKey,value:Omit<GroupOverride,'group'>|undefined):CalibrationOptions {
 const prior=groupOverride(options,group)
 return {...options,overrides:[...(options?.overrides||[]).filter(o=>o!==prior),...(value?[{...value,group}]:[])]}
}
export const ccdTasks = new Set(['ccdproc','zerocombine','darkcombine','flatcombine'])
export const correctionRoles=(task:string)=>task==='zerocombine'?[]:task==='darkcombine'?['zero']:task==='flatcombine'?['zero','dark']:['zero','dark','flat']
export const correctionFlags:Record<string,string> = {zero:'zerocor',dark:'darkcor',flat:'flatcor'}
export const calibrationLabels:Record<string,string> = {images:'원본 영상',input:'결합할 영상',zero:'zero',dark:'dark',flat:'flat'}
export const validExposure = (v:unknown):v is number => typeof v==='number' && Number.isFinite(v) && v>=0
export const headerFrame = (frame:Frame):Frame => frame.calibrationMetadata ? {...frame,...frame.calibrationMetadata} : frame
export function calibrationGroups(frames:Frame[]) {
 const groups=new Map<string,{filter:string;exposure:number|undefined;count:number}>()
 for(const raw of frames){
  const frame=headerFrame(raw)
  const filter=frame.filter?.trim()||'',exposure=validExposure(frame.exposure)?frame.exposure:undefined
  const key=JSON.stringify([filter,exposure]),previous=groups.get(key)
  groups.set(key,{filter,exposure,count:(previous?.count||0)+1})
 }
 return [...groups.values()]
}
export type MetadataMode = 'zero'|'dark'|'flat'|'science'
export function metadataMode(task:string,role:string):MetadataMode|undefined {
 if(role==='zero'||role==='dark'||role==='flat')return role
 if(!['input','images'].includes(role))return undefined
 return ({zerocombine:'zero',darkcombine:'dark',flatcombine:'flat',ccdproc:'science'} as Record<string,MetadataMode>)[task]
}
export function metadataItems(frames:Frame[],mode:MetadataMode):{filter?:string;exposure?:number;count:number}[] {
 if(mode==='zero')return []
 if(mode==='science')return calibrationGroups(frames)
 const groups=new Map<string,{filter?:string;exposure?:number;count:number}>()
 for(const raw of frames){
  const frame=headerFrame(raw)
  const item=mode==='dark'?{exposure:validExposure(frame.exposure)?frame.exposure:undefined}:{filter:frame.filter?.trim()||''}
  const key=JSON.stringify(item)
  groups.set(key,{...item,count:(groups.get(key)?.count||0)+1})
 }
 return [...groups.values()]
}
export function matchCalibration(frame:Frame,candidates:Frame[],role:string):{state:'matched'|'unknown'|'missing'|'ambiguous';id?:string;label?:string} {
 frame=headerFrame(frame);candidates=candidates.map(headerFrame)
 if(role==='dark'&&!validExposure(frame.exposure)||role==='flat'&&!frame.filter?.trim())return {state:'unknown'}
 const matches=[...new Map(candidates.filter(c=>(!frame.shape||!c.shape||frame.shape===c.shape) && (role==='dark'?validExposure(c.exposure)&&Math.abs(c.exposure-frame.exposure!)<=1e-6:role==='flat'?c.filter?.trim()===frame.filter?.trim():true)).map(c=>[c.id,c])).values()]
 return matches.length===1?{state:'matched',id:matches[0].id,label:matches[0].label}: {state:matches.length?'ambiguous':'missing'}
}
