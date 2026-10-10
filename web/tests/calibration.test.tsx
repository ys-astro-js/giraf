import {test,expect} from 'bun:test'
import {calibrationGroups,metadataItems} from '../src/lib/calibration'
import {makeDraft,type Frame,type Spec,type Catalog,type Preferences} from '../src/lib/workbench'
import {makeInstance,emptyMap,payloadFor,restoreRun,workflowRequest,connectionRoles} from '../src/lib/task-map'
const frame=(id:string,filter?:string,exposure?:number):Frame=>({id,label:id,filter,exposure,asset:'image'})
const spec:Spec={name:'ccdproc',title:'ccdproc',package:'noao.imred.ccdred',adapter:'generic',parameters:[],inputs:[{name:'images',label:'images',kind:'image',multiple:true},{name:'dark',label:'dark',kind:'image',multiple:false}],outputs:[{name:'output',kind:'image',mode:'each',default:''}],output:null,kind:'image'}
const cat:Catalog={version:'test',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}

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


