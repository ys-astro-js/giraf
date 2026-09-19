import {test,expect} from 'bun:test'
import {emptyMap,makeInstance,payloadFor,type TaskMap} from '../src/lib/task-map'
import {assigned} from '../src/components/task-inspector'
import type {Catalog,Spec,Preferences} from '../src/lib/workbench'
const spec:Spec={name:'images.immatch.imalign',title:'imalign',package:'images',adapter:'generic',parameters:[],inputs:[{name:'input',label:'Input images',kind:'image',multiple:true},{name:'reference',label:'Reference image',kind:'image',multiple:false}],output:null,kind:'image'}
const cat:Catalog={version:'1',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
function fixture():TaskMap {
 const a=makeInstance(spec,cat,prefs,'a'),b=makeInstance(spec,cat,prefs,'b')
 return {...emptyMap(),tasks:[a,b],connections:[{id:'wire',target:'b',role:'input',source:{kind:'pending',taskId:'a',outputRole:'output'}}],runs:[{id:'old',instanceId:'a',state:'completed',products:[{id:'old-file',label:'old.fits',asset:'image',role:'output'}]},{id:'new',instanceId:'a',state:'completed',products:[{id:'p1',label:'ptarget_1.fits',asset:'image',role:'output'},{id:'p2',label:'ptarget_2.fits',asset:'image',role:'output'},{id:'mask',label:'mask',asset:'image',role:'mask'},{id:'log',label:'log',asset:'text',role:'$log'}]}]}
}
test('existing pending node uses latest completed output in both viewer and execution without nonexistent use button',()=>{
 const m=fixture()
 expect(payloadFor(m,'b',cat).inputs.input).toEqual(['p1','p2'])
 expect(assigned(m,m.tasks[1],'input').ids).toEqual(['p1','p2'])
 expect(assigned(m,m.tasks[1],'input').pending).toEqual([])
 expect(m.connections[0].source.kind).toBe('pending')
})
test('failed latest run never silently reuses older output; error names actual canvas action',()=>{
 const m=fixture();m.runs[1].state='failed'
 expect(()=>payloadFor(m,'b',cat)).toThrow('캔버스')
 expect(()=>payloadFor(m,'b',cat)).not.toThrow('사용’')
 expect(assigned(m,m.tasks[1],'input').ids).toEqual([])
})
test('single-image input requires explicit file selection for multiple results and preserves pinned results',()=>{
 const m=fixture();m.connections[0].role='reference'
 expect(()=>payloadFor(m,'b',cat)).toThrow('파일 선택')
 m.connections[0].source={kind:'result',taskId:'a',runId:'old',ids:['old-file']}
 expect(payloadFor(m,'b',cat).inputs.reference).toEqual(['old-file'])
})
test('multiple upstream links preserve connection order and select compatible outputs without logs',()=>{
 const m=fixture();m.connections[0].source={kind:'pending',taskId:'a'}
 m.connections.unshift({id:'selected',target:'b',role:'input',source:{kind:'files',ids:['chosen'],label:'chosen'}})
 expect(payloadFor(m,'b',cat).inputs.input).toEqual(['chosen','p1','p2','mask'])
})
