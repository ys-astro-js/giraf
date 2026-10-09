import {roleActive} from "../src/lib/node-interaction"
import {test,expect} from 'bun:test'
import {calibrationGroups,matchCalibration,metadataItems,groupOverride,updateGroupOverride} from '../src/lib/calibration'
import {makeDraft,type Frame,type Spec,type Catalog,type Preferences} from '../src/lib/workbench'
import {makeInstance,emptyMap,payloadFor,restoreRun,workflowRequest,connectionRoles} from '../src/lib/task-map'
const frame=(id:string,filter?:string,exposure?:number):Frame=>({id,label:id,filter,exposure,asset:'image'})
const spec:Spec={name:'ccdproc',title:'ccdproc',package:'noao.imred.ccdred',adapter:'generic',parameters:[],inputs:[{name:'images',label:'images',kind:'image',multiple:true},{name:'dark',label:'dark',kind:'image',multiple:false}],outputs:[{name:'output',kind:'image',mode:'each',default:''}],output:null,kind:'image'}
const cat:Catalog={version:'test',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}

test('metadata matching preserves filter identities, does not guess missing values or choose duplicate masters',()=>{
 expect(matchCalibration(frame('s','B',90),[frame('d1','',60),frame('d2','',90)],'dark').id).toBe('d2')
 expect(matchCalibration(frame('s','Ha',90),[frame('f','Ha',3)],'flat').id).toBe('f')
 expect(matchCalibration(frame('s'),[frame('f','B')],'flat').state).toBe('unknown')
 expect(matchCalibration(frame('s','B'),[frame('f','B'),frame('f2','B')],'flat').state).toBe('ambiguous')
 expect(matchCalibration(frame('s','B',90),[frame('d','',60)],'dark').state).toBe('missing')
})
test('metadata summaries show UBVRI, custom filters, zero exposure and missing headers',()=>{
 const rows=[frame('a','B',0),frame('b','V',60),frame('c','Ha',90),frame('d')]
 expect(calibrationGroups(rows)).toHaveLength(4)
 expect(metadataItems(rows,'science')).toEqual([{filter:'B',exposure:0,count:1},{filter:'V',exposure:60,count:1},{filter:'Ha',exposure:90,count:1},{filter:'',exposure:undefined,count:1}]); expect(metadataItems(rows,'zero')).toEqual([]); expect(metadataItems(rows,'dark').every(g=>g.filter===undefined)).toBe(true); expect(metadataItems(rows,'flat').every(g=>g.exposure===undefined)).toBe(true)
})
test('calibration settings and candidate cardinality survive payload, history and workflow',()=>{
 const t=makeInstance(spec,cat,prefs,'s'); t.draft.calibration={matching:'metadata'}; t.draft.inputs={images:['s'],dark:['d1','d2']}
 const map={...emptyMap(),tasks:[t]},p=payloadFor(map,'s',cat)
 expect(p.calibration).toBeUndefined();expect(makeDraft(spec,t.draft).calibration).toEqual(p.calibration)
 expect(workflowRequest(map,cat,'/data').nodes[0].payload.calibration).toEqual(p.calibration)
 expect(restoreRun(emptyMap(),{id:'run',manifest:p},cat,prefs).tasks[0].draft.calibration).toEqual(p.calibration)
 expect(connectionRoles(spec,cat).find(s=>s.name==='dark')?.multiple).toBe(false)
 expect(makeDraft(spec,{parameters:{}}).calibration).toBeUndefined()
 expect(makeDraft(spec,{calibration:{matching:'manual'}}).calibration).toBeUndefined()
})

test('group exceptions preserve other groups and common defaults through payload',()=>{
 const options=updateGroupOverride({matching:'metadata'}, {filter:'Ha',exposure:120}, {output:'ha_',parameters:{darkcor:'no'}})
 const next=updateGroupOverride(options,{filter:'V',exposure:60},{output:'v_'})
 expect(groupOverride(next,{filter:'Ha',exposure:120})?.parameters).toEqual({darkcor:'no'})
 expect(groupOverride(updateGroupOverride(next,{filter:'V',exposure:60},undefined),{filter:'Ha',exposure:120})?.output).toBe('ha_')
 const t=makeInstance(spec,cat,prefs,'s');t.draft.calibration=next
 expect(payloadFor({...emptyMap(),tasks:[t]},'s',cat).calibration).toBeUndefined()
 t.draft.parameters.darkcor='no';t.draft.calibration=updateGroupOverride(next,{filter:'V',exposure:60},{parameters:{darkcor:'yes'}})
 expect(roleActive(t,'dark',cat)).toBe(false)
})

