import {test,expect} from 'bun:test'
import {renderToStaticMarkup} from 'react-dom/server'
import {acceptsAsset, makeDraft, type Spec, type Catalog, type Preferences} from '../src/lib/workbench'
import {makeInstance, emptyMap, workflowRequest, restoreRun, payloadFor} from '../src/lib/task-map'
import {connectFlow} from '../src/lib/workflow-flow'
import {nodeOutput,connectionChoices} from '../src/lib/node-interaction'
import {TaskInspector} from '../src/components/task-inspector'
const creator:Spec={name:'workflow.image_list',taskName:'image_list',title:'image_list',package:'workflow',adapter:'generic',executor:'image-list',parameters:[],inputs:[{name:'input',label:'Input images',kind:'image',multiple:true,required:true}],output:null,outputs:[{name:'output',label:'Output image list',kind:'image-list',mode:'single',default:'images.list'}],kind:'image-list'}
const target:Spec={...creator,name:'extension.reduce',executor:undefined,outputs:[{name:'output',kind:'image',default:'result.fits'}],kind:'image'}
const cat:Catalog={tasks:[creator,target],version:'test',ccdproc:{inputs:[],parameters:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
const noop=()=>{}
test('GUI file selection accepts image lists but rejects arbitrary text for image slots',()=>{
 expect(acceptsAsset('image','image-list')).toBe(true)
 expect(acceptsAsset('image','image')).toBe(true)
 expect(acceptsAsset('image','text')).toBe(false)
 expect(acceptsAsset('text','image-list')).toBe(true)
 expect(acceptsAsset('metacode','image-list')).toBe(false)
});
test('list producer uses common inspector and output controls without an IRAF help link',()=>{
 const t=makeInstance(creator,cat,prefs,'a')
 const html=renderToStaticMarkup(<TaskInspector catalog={cat} map={{...emptyMap(),tasks:[t]}} task={t} rows={[]} edit={noop} pick={noop} onOpen={noop} onRun={noop} busy={false} error="" onErrorFocus={noop} saveDefaults={noop} onRemove={noop} reorderInput={noop}/>);
 expect(html).toContain('Input images');expect(html).toContain('Output image list');expect(html).toContain('images.list');expect(html).not.toContain('iraf.readthedocs.io');
});
test('multiple list nodes connect to an image role and preserve bindings through workflow and history',()=>{
 const a=makeInstance(creator,cat,prefs,'a'), b=makeInstance(creator,cat,prefs,'b'), c=makeInstance(target,cat,prefs,'c');
 let m={...emptyMap(),tasks:[a,b,c]};
 expect(connectionChoices(m,cat,nodeOutput(m,'a'),'c',[]).map(s=>s.name)).toEqual(['input']);
 m=connectFlow(m,cat,[],{source:'a',sourceHandle:'output',target:'c',targetHandle:'input'});m=connectFlow(m,cat,[],{source:'b',sourceHandle:'output',target:'c',targetHandle:'input'});
 m=connectFlow(m,cat,[],{source:'b',sourceHandle:'output',target:'c',targetHandle:'input'});
 expect(m.connections).toHaveLength(2);
 const graph=workflowRequest(m,cat,'/data');expect(graph.links).toHaveLength(2);expect(graph.links.every(l=>l.kind==='image')).toBe(true);
 c.draft=makeDraft(target,{inputs:{input:['list1','list2']}});
 const payload=payloadFor({...emptyMap(),tasks:[c]},'c',cat);
 expect(payload.inputs.input).toEqual(['list1','list2']);
 expect(restoreRun(emptyMap(),{id:'run',manifest:{...payload,inputs:{input:['expanded-image']},inputSelections:{input:['list1','list2']}}},cat,prefs).tasks[0].draft.inputs.input).toEqual(['list1','list2']);
 const result={kind:'result' as const,taskId:'a',runId:'run',ids:['list1','list2']};
 expect(connectionChoices(m,cat,result,'c',[{id:'list1',label:'A.list',asset:'image-list'},{id:'list2',label:'B.list',asset:'image-list'}]).map(s=>s.name)).toEqual(['input']);
});
