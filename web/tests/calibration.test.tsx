import {nodeGeometry,roleActive} from "../src/lib/node-interaction"
import {inputPorts,outputPorts,portHandle,compactPortLabel,portFrames} from "../src/lib/calibration-ports"
import {connectFlow,flowEdges,connectInputPort} from "../src/lib/workflow-flow"
import {test,expect} from 'bun:test'
import {calibrationGroups,matchCalibration,metadataItems,groupOverride,updateGroupOverride} from '../src/lib/calibration'
import {makeDraft,type Frame,type Spec,type Catalog,type Preferences} from '../src/lib/workbench'
import {makeInstance,emptyMap,payloadFor,restoreRun,workflowRequest,connectionRoles} from '../src/lib/task-map'
const frame=(id:string,filter?:string,exposure?:number):Frame=>({id,label:id,filter,exposure,asset:'image'})
const spec:Spec={name:'ccdproc',title:'ccdproc',package:'noao.imred.ccdred',adapter:'generic',parameters:[],inputs:[{name:'images',label:'images',kind:'image',multiple:true},{name:'dark',label:'dark',kind:'image',multiple:false}],outputs:[{name:'output',kind:'image',mode:'each',default:''}],output:null,kind:'image'}
const cat:Catalog={version:'test',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}

test('metadata tracing merges shared ancestors without multiplying frame references', () => {
 const root=makeInstance(spec,cat,prefs,'root')
 root.draft.inputs.images=['b','v','b','list','missing']
 const map={...emptyMap(),tasks:[root]}
 let parents=[root.id]
 for(let level=0;level<16;level++) {
  const next=[`${level}a`,`${level}b`]
  for(const id of next) {
   map.tasks.push(makeInstance(spec,cat,prefs,id))
   for(const parent of parents) map.connections.push({id:parent+'-'+id,target:id,role:'images',source:{kind:'pending',taskId:parent}})
  }
  parents=next
 }
 const rows=[frame('b','B',60),frame('v','V',90),{...frame('list'),asset:'image-list'}]
 expect(portFrames(map,map.tasks.at(-1)!,'images',cat,rows).map(r=>r.id)).toEqual(['b','v'])
 // Results must be fresh after edits, not retained across graph snapshots.
 root.draft.inputs.images=['v']
 expect(portFrames(map,map.tasks.at(-1)!,'images',cat,rows).map(r=>r.id)).toEqual(['v'])
})

test('metadata tracing preserves branch filters, frame precedence and result selections', () => {
 const root=makeInstance(spec,cat,prefs,'root'),target=makeInstance(spec,cat,prefs,'target')
 root.draft.inputs.images=['b','v']
 const map={...emptyMap(),tasks:[root,target]}
 map.runs=[{id:'run',instanceId:'root',state:'completed',products:[frame('b','old',1),frame('result','Ha',120)]}]
 map.connections=[
  {id:'v',target:'target',role:'images',source:{kind:'pending',taskId:'root',group:{filter:'V'}}},
  {id:'b',target:'target',role:'images',source:{kind:'pending',taskId:'root',group:{filter:'B'}}},
  {id:'result',target:'target',role:'images',source:{kind:'result',runId:'run',ids:['result','v']}},
 ]
 const rows=[frame('b','B',60),frame('v','V',90)]
 expect(portFrames(map,target,'images',cat,rows)).toEqual([rows[1],rows[0],map.runs[0].products[1]])
 map.connections[0].source.group={filter:'B',exposure:90}
 expect(portFrames(map,target,'images',cat,rows).map(r=>r.id)).toEqual(['b','result','v'])
})

test('metadata tracing tolerates cycles without caching path-dependent partial results', () => {
 const [a,b,target]=['a','b','target'].map(id=>makeInstance(spec,cat,prefs,id))
 const map={...emptyMap(),tasks:[a,b,target]}
 map.connections=[
  {id:'ab',target:'b',role:'images',source:{kind:'pending',taskId:'a'}},
  {id:'ba',target:'a',role:'images',source:{kind:'pending',taskId:'b'}},
  {id:'files',target:'a',role:'images',source:{kind:'files',ids:['f'],label:'f'}},
  {id:'at',target:'target',role:'images',source:{kind:'pending',taskId:'a',group:{filter:'V'}}},
  {id:'bt',target:'target',role:'images',source:{kind:'pending',taskId:'b'}},
 ]
 expect(portFrames(map,target,'images',cat,[frame('f','B',60)]).map(r=>r.id)).toEqual(['f'])
})

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
 const darkSpec:Spec={name:'darkcombine',title:'darkcombine',package:'ccdred',parameters:[],inputs:[{name:'input',kind:'image',label:'input',multiple:true}],output:{name:'output',mode:'combine',default:'Dark.fits'},kind:'image'}
 const flatSpec={...darkSpec,name:'flatcombine'}
 const extended={...cat,tasks:[spec,darkSpec,flatSpec]}
 const dark=makeInstance(darkSpec,extended,prefs,'dark');dark.draft.inputs.input=['d60','d90'];dark.draft.calibration={group:'exposure'}
 const flat=makeInstance(flatSpec,extended,prefs,'flat');flat.draft.inputs.input=['fb','fv'];flat.draft.parameters.subsets='yes'
 const science=makeInstance(spec,extended,prefs,'science');science.draft.inputs.images=['b','v'];science.draft.parameters.darkcor='yes';science.draft.calibration={matching:'metadata'}
 const frames=[frame('d60','',60),frame('d90','',90),frame('fb','B',3),frame('fv','V',3),frame('b','B',90),frame('v','V',60)]
 dark.description='사용자가 작성한 dark 설명';flat.description='';
 const graph={...emptyMap(),tasks:[dark,flat,science]}
 const ports=outputPorts(graph,dark,extended,frames)
 expect(compactPortLabel({filter:'B',exposure:90})).toBe('B90');expect(compactPortLabel({exposure:60})).toBe('60s');expect(compactPortLabel({filter:'V'})).toBe('V')
 expect(outputPorts({...graph,tasks:[{...flat,draft:{...flat.draft,inputs:{input:['inferred']}}}]}, {...flat,draft:{...flat.draft,inputs:{input:['inferred']}}},extended,[{...frame('inferred','B',3),calibrationMetadata:{filter:'',exposure:3}}]).map(p=>p.group)).toEqual([{filter:'B'}])
 expect(inputPorts(graph,dark,extended,frames).filter(p=>p.role==='input' && p.name!=='input').every(p=>!!p.group)).toBe(true)
 expect(inputPorts(graph,science,extended,frames).filter(p=>p.role==='images').map(p=>p.group)).toEqual([undefined])
 expect(ports.map(p=>p.group)).toEqual([{exposure:60},{exposure:90}])
 expect(outputPorts(graph,flat,extended,frames).map(p=>p.group)).toEqual([{filter:'B'},{filter:'V'}])
 expect(outputPorts(graph,science,extended,frames).map(p=>p.group)).toEqual([{filter:'B',exposure:90},{filter:'V',exposure:60}])
 expect(inputPorts(graph,science,extended,frames).filter(p=>p.role==='dark').map(p=>p.group)).toEqual([undefined,{exposure:90},{exposure:60}])
 const linked=connectFlow(graph,extended,frames,{source:'dark',sourceHandle:ports[1].handleId,target:'science',targetHandle:portHandle('input','dark',{exposure:90})})
 expect(linked.connections[0].source.group).toEqual({exposure:90});expect(linked.connections[0].targetGroup).toEqual({exposure:90})
 expect(workflowRequest(linked,extended,'/data').links[0].sourceGroup).toEqual({exposure:90})
 expect(flowEdges(linked,extended)[0].sourceHandle).toBe('output');expect(flowEdges(linked,extended)[0].targetHandle).toBe('dark')
 expect(flowEdges(linked,extended)[0]).not.toHaveProperty('label')
 const legacy={...linked,tasks:linked.tasks.map(t=>({...t,draft:{...t.draft,calibration:undefined}}))}
 const legacyTarget=legacy.tasks.find(t=>t.id==='science')!
 expect(inputPorts(legacy,legacyTarget,extended,frames).map(p=>p.name)).toContain(flowEdges(legacy,extended)[0].targetHandle!)
 const master=makeInstance(darkSpec,extended,prefs,'master');master.draft.calibration={group:'exposure'}
 const second={...dark,id:'dark2'}
 let combined={...graph,tasks:[...graph.tasks,second,master]}
 for(const source of ['dark','dark2']) combined=connectFlow(combined,extended,frames,{source,sourceHandle:ports[1].handleId,target:'master',targetHandle:portHandle('input','input',{exposure:90})})
 expect(combined.connections.filter(c=>c.target==='master')).toHaveLength(2)
 const lists=[{...frame('list1'),asset:'image-list'},{...frame('list2'),asset:'image-list'}]
 const listed=connectInputPort(combined,extended,[...frames,...lists],'master',portHandle('input','input',{exposure:90}),{kind:'files',ids:['list1','list2'],label:'lists'})
 expect(payloadFor(listed,'master',extended).inputs.input).toEqual(['list1','list2'])
 expect(()=>connectFlow(graph,extended,frames,{source:'dark',sourceHandle:ports[0].handleId,target:'science',targetHandle:portHandle('input','dark',{exposure:90})})).toThrow()

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

test('split inputs retain a whole-bundle port beside each group',()=>{
 const ds:Spec={...spec,name:'darkcombine',inputs:[{name:'input',label:'결합할 영상',kind:'image',multiple:true}]}
 const catalog={...cat,tasks:[ds]},t=makeInstance(ds,catalog,prefs,'dark')
 t.draft.inputs.input=['a','b'];t.draft.calibration={group:'exposure'}
 const ports=inputPorts({...emptyMap(),tasks:[t]},t,catalog,[frame('a','',15),frame('b','',30)])
 expect(ports.map(p=>p.group)).toEqual([undefined,{exposure:15},{exposure:30}])
 const g=nodeGeometry({...emptyMap(),tasks:[t]},t,catalog,[frame('a','',15),frame('b','',30)])
 expect(g.height).toBe(176)
 expect(g.roles.map(p=>p.name)).toEqual(["input"])
 expect(g.inputY("input")).toBe(96)
 expect(g.outputs).toEqual([])
})
