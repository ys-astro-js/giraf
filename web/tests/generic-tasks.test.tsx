import {test, expect} from 'bun:test'
import {makeDraft, plannedOutputs, type Catalog, type Spec, type Preferences} from '../src/lib/workbench'
import {makeInstance, emptyMap, payloadFor, restoreRun, connectionRoles, resetInstanceParameters, workflowRequest} from '../src/lib/task-map'
import {connectionChoices, nodeOutput, nodeGeometry} from '../src/lib/node-interaction'
const p = {name:'sigma',type:'r',default:2,choices:[],prompt:'Noise estimate',min:0,max:''}
const spec:Spec = {name:'demo.measure',taskName:'measure',title:'measure',package:'demo',adapter:'generic',runnable:true,parameters:[p],inputs:[{name:'zero',label:'Reference',multiple:false,kind:'image'}],output:null,outputs:[{name:'table',kind:'text',default:'measure.txt'},{name:'image',kind:'image',default:'result.fits'}],parameterSets:[{name:'datapars',task:'demo.datapars',parameters:[p]}],kind:'text'}
const catalog:Catalog={version:'test',tasks:[spec],ccdproc:{parameters:[],inputs:[{name:'zero',label:'Bias',multiple:true,kind:'image'}]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
test('generic nodes require no CCD task and preserve package sets, outputs and namespace through restore',()=>{
 const task=makeInstance(spec,catalog,prefs,'a');task.draft.outputs={table:'edited.txt',image:'new.fits'};task.parameterSets={datapars:{sigma:4}}
 const target=makeInstance(spec,catalog,prefs,'b')
 expect(connectionChoices({...emptyMap(),tasks:[task,target]},catalog,{kind:'pending',taskId:'a'},'b',[]).map(s=>s.name)).toEqual(['zero'])
 const payload=payloadFor({...emptyMap(),tasks:[task]},'a',catalog)
 expect(payload.task).toBe('demo.measure');expect(payload.outputs.table).toBe('edited.txt');expect(payload.parameterSets.datapars.sigma).toBe(4)
 expect(payload.inputs.instrument).toBeUndefined();expect(connectionRoles(spec,catalog).map(s=>s.name)).toEqual(['zero'])
 const restored=restoreRun(emptyMap(),{id:'run',manifest:payload},catalog,prefs).tasks[0]
 expect(restored.parameterSets).toEqual(task.parameterSets);expect(restored.draft.outputs).toEqual(task.draft.outputs)
 const reset=resetInstanceParameters(task,spec)
 expect(payloadFor({...emptyMap(),tasks:[reset]},'a',catalog).parameterSets.datapars.sigma).toBe(2)
 expect(reset.draft.outputs).toEqual(task.draft.outputs)
 expect(payloadFor({...emptyMap(),tasks:[restored]},restored.id,catalog).parameterSets.datapars.sigma).toBe(4)
})
test('no input tasks and multiple outputs have complete previews',()=>{
 const task={...spec,inputs:[]};expect(plannedOutputs(task,makeDraft(task),[]).map(p=>p.output)).toEqual(['measure.txt','result.fits'])
})

test('generated ports connect before execution and keep a selected output role through workflow submission',()=>{
 const source={...spec,outputs:[{name:'science',kind:'image',default:'science.fits'},{name:'mask',kind:'image',default:'mask.fits'}]};
 const a=makeInstance(source,catalog,prefs,'a'),b=makeInstance(spec,catalog,prefs,'b');
 const map={...emptyMap(),tasks:[a,b],connections:[{id:'wire',target:'b',role:'zero',source:{kind:'pending' as const,taskId:'a',outputRole:'science'}}]};
 const cat={...catalog,tasks:[source]};
 expect(connectionChoices(map,cat,map.connections[0].source,'b',[]).map(p=>p.name)).toEqual(['zero']);
 expect(workflowRequest(map,cat,'/data').links[0].sourceRole).toBe('science');
 const completed={...map,runs:[{id:'run',instanceId:'a',state:'completed',products:[{id:'image',label:'science',asset:'image',role:'science'},{id:'mask',label:'mask',asset:'image',role:'mask'},{id:'log',label:'log',asset:'text',role:'$log'}]}]};
 expect(nodeOutput(completed,'a','science')).toMatchObject({kind:'result',ids:['image'],outputRole:'science'});
})
test('optional generated outputs are omitted from previews until a filename is entered',()=>{
 const s={...spec,outputs:[{name:'variance',kind:'image',optional:true,default:''}]};
 expect(plannedOutputs(s,makeDraft(s),[]).some(p=>p.output==='')).toBe(false);
 const d=makeDraft(s);d.outputs={variance:'variance.fits'};
 expect(plannedOutputs(s,d,[]).map(p=>p.output)).toEqual(['variance.fits']);
})
test('binary and mask outputs retain their role after execution and connect by exact format',()=>{
 const outputs=[{name:'output',kind:'text',default:'phot.txt'},{name:'plotfile',kind:'metacode',default:'profiles.gki'}];
 const source={...spec,outputs},target={...spec,name:'demo.plot',inputs:[{name:'input',label:'Metacode',kind:'metacode',multiple:true}]};
 const cat={...catalog,tasks:[source,target]};const a=makeInstance(source,cat,prefs,'a'),b=makeInstance(target,cat,prefs,'b');
 const map={...emptyMap(),tasks:[a,b],runs:[{id:'run',instanceId:'a',state:'completed',products:[{id:'table',label:'phot',asset:'text',role:'output'},{id:'gki',label:'profiles',asset:'metacode',role:'plotfile'},{id:'mask',label:'mask',asset:'mask',role:'mask'}]}]};
 expect(nodeOutput(map,'a','plotfile')).toMatchObject({kind:'result',ids:['gki'],outputRole:'plotfile'});
 expect(nodeOutput(map,'a','mask')).toMatchObject({kind:'result',ids:['mask'],outputRole:'mask'});
 expect(connectionChoices(map,cat,nodeOutput(map,'a','plotfile'),'b',[]).map(s=>s.name)).toEqual(['input']);
 const geometry=nodeGeometry(map,a,cat);expect(geometry.outputs.map(o=>o.name)).toEqual(['output','plotfile']);expect(geometry.outputs[1].y-geometry.outputs[0].y).toBe(36);expect(geometry.outputs[1].x).toBe(geometry.width);
 const single=nodeGeometry(map,a,{...cat,tasks:[{...source,outputs:[outputs[0]]},target]});expect(single.outputs).toHaveLength(0);expect(single.outputY).toBe(geometry.outputs.at(-1)!.y);
})

test('cursor commands survive workflow and history serialization',()=>{
 const s={...spec,inputs:[{name:'image',label:'Input images',kind:'image',multiple:true},{name:'icommands',label:'Image cursor: [x y wcs] key [cmd]',kind:'text',multiple:false,valueType:'cursor',cursorType:'imcur'}]};
 const cat={...catalog,tasks:[s]},task=makeInstance(s,cat,prefs,'a');
 task.draft.cursorCommands={icommands:'32 32 1 \\040\nq\n'};
 const m={...emptyMap(),tasks:[task]},payload=payloadFor(m,'a',cat);
 expect(payload.cursorCommands).toEqual(task.draft.cursorCommands);
 expect(workflowRequest(m,cat,'/data').nodes[0].payload.cursorCommands).toEqual(task.draft.cursorCommands);
 expect(restoreRun(emptyMap(),{id:'run',manifest:payload},cat,prefs).tasks[0].draft.cursorCommands).toEqual(task.draft.cursorCommands);
});
test('legacy drafts retain current parameters and migrate saved output names',()=>{
 const migrated = makeDraft({...spec, outputs:[{name:'output',kind:'image',default:''}]}, {parameters:{sigma:3,retired:'yes'},output:{name:'saved_'}});
 expect(migrated.parameters).toEqual({sigma:3});
 expect(migrated.outputs).toEqual({output:'saved_'});
});
