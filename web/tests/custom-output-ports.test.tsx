import { expect, test } from 'bun:test'
import { emptyMap, makeInstance, publishWorkflowRun, resolvedSource, workflowRequest } from '../src/lib/task-map'
import { nodeGeometry } from '../src/lib/node-interaction'
import { connectFlow, flowEdges } from '../src/lib/workflow-flow'
import { customOutput, updateOutputPort, removeOutputPort, customPortHandle } from '../src/lib/output-ports'
import type { Catalog, Preferences, Spec, Frame } from '../src/lib/workbench'
const spec: Spec = {name:'stack',title:'stack',package:'images',adapter:'generic',parameters:[],inputs:[{name:'input',label:'input',kind:'image',multiple:true}],output:null,kind:'image'}
const catalog: Catalog = {version:'1',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs: Preferences = {drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
const products = [{id:'b',label:'FlatB.fits',asset:'image'},{id:'v',label:'FlatV.fits',asset:'image'},{id:'log',label:'log',asset:'text',role:'$log'}] as Frame[]
function fixture() { const map = {...emptyMap(),tasks:['a','b'].map(id=>makeInstance(spec,catalog,prefs,id))}; map.tasks[0].outputPorts=[{id:'blue',name:'B',files:['*B.fits']},{id:'all',name:'',files:['*']}]; return map }
test('custom ports preserve node body height and expose stable port handles',()=>{
 const map=fixture(),g=nodeGeometry(map,map.tasks[0],catalog)
 const plain=nodeGeometry(map,{...map.tasks[0],outputPorts:[]},catalog)
 expect(g.height).toBe(plain.height)
 expect(g.outputs.at(-1)!.y).toBe(g.height-24)
 expect(g.outputs.every(p=>p.x===g.width)).toBe(true)
 expect(g.outputs[0].y).toBeGreaterThan(g.outputY)
 expect(customPortHandle('$default')).toBe('output')
 const configured=updateOutputPort(map,'a',{id:'$default',name:'기본',files:['*B.fits']})
 const connected=connectFlow(configured,catalog,[],{source:'a',target:'b',sourceHandle:'output',targetHandle:'input'})
 expect(connected.connections[0].source).toMatchObject({files:['*B.fits'],port:'output'})
 expect(g.outputs.map(p=>p.handleId)).toContain('output-custom:blue')
})
test('pending custom connections retain file selection through execution and rerun',()=>{
 let map=fixture()
 map=connectFlow(map,catalog,[],{source:'a',target:'b',sourceHandle:'output-custom:blue',targetHandle:'input'})
 expect(flowEdges(map,catalog)[0].sourceHandle).toBe('output-custom:blue')
 expect(map.connections[0].source).toMatchObject({kind:'pending',files:['*B.fits'],port:'output-custom:blue'})
 map=publishWorkflowRun(map,'a',{id:'r',state:'completed',products},catalog)
 expect(map.connections[0].source).toMatchObject({kind:'result',ids:['b']})
 expect(workflowRequest(map,catalog,'/tmp').links[0].sourceFiles).toEqual(['*B.fits'])
 expect(resolvedSource(map,{kind:'pending',taskId:'a',files:['*V.fits']})).toMatchObject({ids:['v']})
})
test('port updates refresh connected selection, empty selection never exports all, deletion detaches only that port',()=>{
 let map=fixture();map.runs=[{id:'r',instanceId:'a',state:'completed',products}]
 map=connectFlow(map,catalog,[],{source:'a',target:'b',sourceHandle:'output-custom:blue',targetHandle:'input'})
 map=updateOutputPort(map,'a',{id:'blue',name:'renamed',files:['*V.fits']})
 expect(map.connections[0].source).toMatchObject({ids:['v'],port:'output-custom:blue'})
 expect(customOutput(map,'a',{id:'empty',name:'',files:[]})).toMatchObject({kind:'pending',files:[]})
 const moved=connectFlow(map,catalog,[],{source:'a',target:'b',sourceHandle:'output',targetHandle:'input'},map.connections[0].id)
 expect(moved.connections[0].source.port).toBeUndefined()
 const roleMap={...map,connections:map.connections.map(c=>({...c,source:{...c.source,port:'output:mask'}}))}
 const movedRole=connectFlow(roleMap,catalog,[],{source:'a',target:'b',sourceHandle:'output',targetHandle:'input'},roleMap.connections[0].id)
 expect(movedRole.connections[0].source.files).toBeUndefined()
 expect(removeOutputPort(map,'a','blue').connections).toHaveLength(0)
 expect(removeOutputPort(map,'a','blue').tasks[0].outputPorts).toHaveLength(1)
})
test('file patterns are case sensitive and treat regex syntax literally',()=>{
 const map=fixture();map.runs=[{id:'r',instanceId:'a',state:'completed',products:[...products,{id:'special',label:'a[1].fits',asset:'image'} as Frame]}]
 expect(customOutput(map,'a',{id:'p',name:'',files:['a[1].fits']})).toMatchObject({ids:['special']})
 expect(customOutput(map,'a',{id:'p',name:'',files:['flatb.fits']})).toMatchObject({kind:'pending'})
})
