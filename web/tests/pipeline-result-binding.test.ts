import {expect,test} from 'bun:test'
import {emptyMap,makeInstance,publishWorkflowRun,workflowRequest} from '../src/lib/task-map'
import type {Catalog,Preferences,Spec,Job} from '../src/lib/workbench'
const spec:Spec={name:'stack',title:'stack',package:'images',adapter:'generic',parameters:[],inputs:[{name:'input',label:'input',kind:'image',multiple:true}],output:null,kind:'image'}
const catalog:Catalog={version:'1',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
function fixture(){return {...emptyMap(),tasks:['flat','b'].map(id=>makeInstance(spec,catalog,prefs,id)),connections:[{id:'edge',target:'b',role:'input',source:{kind:'pending' as const,taskId:'flat',group:{filter:'B'},outputRole:'output'}}]}}
const job={id:'run1',state:'completed',products:[{id:'B',label:'FlatB.fits',asset:'image',role:'output',filter:'B'},{id:'V',label:'FlatV.fits',asset:'image',role:'output',filter:'V'},{id:'mask',label:'mask',asset:'image',role:'mask',filter:'B'},{id:'log',label:'log',asset:'text',role:'$log'}]} as Job

test('workflow completion retains band and output role for the next full rerun',()=>{
 const map=publishWorkflowRun(fixture(),'flat',job,catalog)
 expect(map.connections[0].source).toEqual({kind:'result',taskId:'flat',group:{filter:'B'},outputRole:'output',runId:'run1',ids:['B']})
 const graph=workflowRequest(map,catalog,'/tmp')
 expect(graph.links[0].sourceGroup).toEqual({filter:'B'})
 expect(graph.links[0].sourceRole).toBe('output')
})
test('missing requested band does not bind a different band',()=>{
 const m=fixture();m.connections[0].source.group={filter:'R'}
 expect(publishWorkflowRun(m,'flat',job,catalog).connections[0].source.kind).toBe('pending')
})
