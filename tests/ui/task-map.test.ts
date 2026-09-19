import { expect, test } from 'bun:test'
import { addTask, connect, disconnect, emptyMap, makeInstance, payloadFor, publishRun, replacePending, restoreRun, layoutMap, migrateMap, connectionRoles } from '../../web/src/lib/task-map'
import { makeDraft, type Catalog, type Spec, type Preferences } from '../../web/src/lib/workbench'

const p=(name:string,value:string)=>({name,default:value,type:'s',choices:[],prompt:name,min:'',max:''})
const s=(name:string)=>({name,label:name,multiple:true,kind:'image'})
const proc:Spec={name:'ccdproc',title:'CCD 보정',package:'noao.imred.ccdred',parameters:[p('zerocor','yes'),p('ccdtype','object')],inputs:[s('images'),s('zero')],output:{name:'output',mode:'each',default:'p'},kind:'image'}
const combine:Spec={name:'combine',title:'결합',package:proc.package,parameters:[p('zero','none')],inputs:[s('input')],output:{name:'output',mode:'combine',default:'Combined.fits'},kind:'image'}
const dark:Spec={...combine,name:'darkcombine',preprocess:true,parameters:[p('process','yes')]}
const catalog:Catalog={version:'2.18.1',tasks:[proc,combine,dark],ccdproc:{parameters:proc.parameters,inputs:[s('zero')]},ccdred:[p('backup','')],exam:{}}
const prefs:Preferences={drafts:{ccdproc:makeDraft(proc,{inputs:{zero:['external']}})},backend:'cl',mapping:{subset:'FILTER'},instrument:[],packageValues:{backup:''}}

test('same task can have independent copies of every setting and calibration',()=>{
  const a=makeInstance(dark,catalog,prefs,'a'),b=makeInstance(dark,catalog,prefs,'b')
  a.preprocess.parameters.zerocor='no';a.preprocess.inputs.zero.push('second');a.mapping.subset='BAND'
  expect(b.preprocess.parameters.zerocor).toBe('yes')
  expect(b.preprocess.inputs.zero).toEqual(['external'])
  expect(prefs.mapping.subset).toBe('FILTER')
})
test('task roles distinguish combine.zero expression and ccdproc.zero image',()=>{
  expect(connectionRoles(combine,catalog).map(x=>x.name)).toEqual(['input'])
  expect(connectionRoles(dark,catalog).map(x=>x.name)).toContain('zero')
})
test('connections never run tasks and pending results block execution until explicitly bound',()=>{
  let m=addTask(addTask(emptyMap(),makeInstance(combine,catalog,prefs,'a')),makeInstance(proc,catalog,prefs,'b'))
  m=connect(m,'b','zero',{kind:'pending',taskId:'a'},false)
  expect(()=>payloadFor(m,'b',catalog)).toThrow(/combine.*먼저 실행/)
  m=publishRun(m,'a',{id:'run1',state:'completed',products:[{id:'v1',label:'master.fits',asset:'image'}]})
  expect(m.connections[0].source.kind).toBe('pending')
  expect(()=>payloadFor(m,'b',catalog)).toThrow(/master.fits.*사용/)
  m=replacePending(m,m.connections[0].id,'run1',['v1'])
  expect(payloadFor(m,'b',catalog).inputs.zero).toEqual(['v1'])
  m=publishRun(m,'a',{id:'run2',state:'completed',products:[{id:'v2',label:'master.fits',asset:'image'}]})
  expect(payloadFor(m,'b',catalog).inputs.zero).toEqual(['v1'])
  expect(m.runs.map(r=>r.id)).toEqual(['run1','run2'])
})
test('connection removal and ordered duplicate inputs do not delete data or mutate history',()=>{
  let m=addTask(emptyMap(),makeInstance(combine,catalog,prefs,'a'))
  m=connect(m,'a','input',{kind:'files',ids:['x','y','x'],label:'선택'},false)
  expect(payloadFor(m,'a',catalog).inputs.input).toEqual(['x','y','x'])
  const before=JSON.stringify(m)
  const removed=disconnect(m,m.connections[0].id)
  expect(payloadFor(removed,'a',catalog).inputs.input).toEqual([])
  expect(JSON.stringify(m)).toBe(before)
})
test('cycle and self links are rejected; forward pending links are supported',()=>{
  let m=addTask(addTask(emptyMap(),makeInstance(combine,catalog,prefs,'a')),makeInstance(combine,catalog,prefs,'b'))
  expect(()=>connect(m,'a','input',{kind:'pending',taskId:'a'},false)).toThrow()
  m=connect(m,'b','input',{kind:'pending',taskId:'a'},false)
  expect(()=>connect(m,'a','input',{kind:'pending',taskId:'b'},false)).toThrow()
})
test('restoring a run creates a new draft and freezes effective preprocessing/package values',()=>{
  let m=addTask(emptyMap(),makeInstance(dark,catalog,prefs,'a'))
  m=connect(m,'a','input',{kind:'files',ids:['raw'],label:'raw'},false)
  const payload=payloadFor(m,'a',catalog)
  const job={id:'r',task:'darkcombine',manifest:payload}
  const restored=restoreRun(m,job,catalog,prefs,'restored')
  expect(restored.tasks.length).toBe(2)
  expect(payloadFor(restored,'restored',catalog).inputs.input).toEqual(['raw'])
  restored.tasks[1].preprocess.parameters.zerocor='no'
  expect(payload.ccdproc.zerocor).toBe('yes')
  expect(m.tasks[0].preprocess.parameters.zerocor).toBe('yes')
})
test('migration preserves saved drafts and serialized map navigation state',()=>{
  const migrated=migrateMap({...prefs,drafts:{...prefs.drafts,darkcombine:makeDraft(dark,{inputs:{input:['a','b']}})}},catalog)
  expect(migrated.tasks.some(t=>t.task==='darkcombine')).toBe(true)
  migrated.view={...migrated.view,mode:'list',selected:migrated.tasks[0].id,zoom:1.5,x:35,y:50}
  expect(migrateMap({...prefs,taskMap:JSON.parse(JSON.stringify(migrated))},catalog).view).toEqual(migrated.view)
})
test('large input sets remain ordered and map layout is deterministic without overlapping task nodes',()=>{
  let m=emptyMap()
  for(let i=0;i<120;i++)m=addTask(m,makeInstance(combine,catalog,prefs,'t'+i))
  const ids=Array.from({length:10000},(_,i)=>'f'+i)
  m=connect(m,'t0','input',{kind:'files',ids,label:'large'},false)
  expect(payloadFor(m,'t0',catalog).inputs.input).toEqual(ids)
  const layout=layoutMap(m)
  expect(layout).toEqual(layoutMap(m))
  expect(new Set(layout.map(n=>`${n.x}:${n.y}`)).size).toBe(layout.length)
})

test('custom node metadata survives persistence without changing execution identity',()=>{
 const original=makeInstance(proc,catalog,prefs,'a');
 const changed={...original,label:'과학 영상',description:'Bias 보정'};
 const m=addTask(emptyMap(),changed);
 const restored=migrateMap({...prefs,taskMap:JSON.parse(JSON.stringify(m))},catalog);
 expect(restored.tasks[0]).toMatchObject({label:'과학 영상',description:'Bias 보정',task:'ccdproc'});
 expect(payloadFor(restored,'a',catalog)).toEqual(payloadFor(addTask(emptyMap(),original),'a',catalog));
});
