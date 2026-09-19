import { expect, test } from 'bun:test'
import { addTask, connect, emptyMap, layoutMap, makeInstance, moveTask, removeTask, restoreTask, publishRun, workflowRequest } from '../../web/src/lib/task-map'
import type { Catalog, Preferences, Spec } from '../../web/src/lib/workbench'

const spec:Spec={name:'ccdproc',title:'CCD 보정',package:'noao.imred.ccdred',parameters:[],inputs:[{name:'images',label:'입력 영상',multiple:true,kind:'image'}],output:{name:'output',mode:'each',default:'p_'},kind:'image'}
const catalog:Catalog={version:'test',tasks:[spec],ccdproc:{parameters:[],inputs:[]},ccdred:[],exam:{}}
const prefs:Preferences={drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
const fixture=()=>['a','b','c'].reduce((m,id)=>addTask(m,makeInstance(spec,catalog,prefs,id)),emptyMap())

test('drag displacement is converted from screen pixels at the active zoom and persists',()=>{
  const m=fixture(),p=layoutMap(m)[0]
  const next=moveTask(m,'a',{x:p.x,y:p.y},{x:100,y:60},.5)
  expect(next.tasks[0].position).toEqual({x:p.x+200,y:p.y+120})
  expect(layoutMap(JSON.parse(JSON.stringify(next)))[0]).toMatchObject(next.tasks[0].position!)
  expect(m.tasks[0].position).toBeUndefined()
})
test('moving against canvas bounds clamps without changing inputs or connections',()=>{
  const m=connect(fixture(),'a','images',{kind:'files',ids:['raw'],label:'raw'})
  const next=moveTask(m,'a',{x:32,y:32},{x:-1000,y:-1000},1)
  expect(next.tasks[0].position).toEqual({x:24,y:24})
  expect(next.connections).toEqual(m.connections)
})
test('deleting a node removes pending relations but preserves recorded results and unrelated tasks',()=>{
  let m=connect(fixture(),'b','images',{kind:'pending',taskId:'a'})
  m=publishRun(m,'a',{id:'r1',state:'completed',products:[{id:'out',label:'out.fits'}]})
  m=connect(m,'c','images',{kind:'result',taskId:'a',runId:'r1',ids:['out']})
  m={...m,view:{...m.view,selected:'a'}}
  const next=removeTask(m,'a')
  expect(next.tasks.map(t=>t.id)).toEqual(['b','c'])
  expect(next.connections).toHaveLength(1)
  expect(next.connections[0].source).toEqual({kind:'result',runId:'r1',ids:['out']})
  expect(next.runs).toEqual(m.runs)
  expect(next.view.selected).toBe('b')
  expect(m.tasks).toHaveLength(3)
})
test('undo restores the removed node without rolling back later edits or run updates',()=>{
  const before=connect(fixture(),'b','images',{kind:'pending',taskId:'a'})
  let m=removeTask(before,'a')
  m={...m,tasks:m.tasks.map(t=>t.id==='c'?{...t,label:'edited later'}:t)}
  m=publishRun(m,'c',{id:'new-run',state:'running',products:[]})
  const restored=restoreTask(m,before,'a')
  expect(restored.tasks.map(t=>t.id)).toEqual(['a','b','c'])
  expect(restored.tasks.find(t=>t.id==='c')?.label).toBe('edited later')
  expect(restored.runs.map(r=>r.id)).toEqual(['new-run'])
  expect(restored.connections).toEqual(before.connections)
})
test('undo does not replace a downstream input the user changed after deletion',()=>{
  const before=connect(fixture(),'b','images',{kind:'pending',taskId:'a'})
  const m=connect(removeTask(before,'a'),'b','images',{kind:'files',ids:['different'],label:'different'},false)
  const restored=restoreTask(m,before,'a')
  expect(restored.connections).toEqual(m.connections)
})
test('automatic layout follows dependencies left to right without overlapping independent nodes',()=>{
  const m=connect(connect(fixture(),'b','images',{kind:'pending',taskId:'a'}),'c','images',{kind:'pending',taskId:'b'})
  const [a,b,c]=layoutMap(m)
  expect(b.x-a.x).toBeGreaterThanOrEqual(280)
  expect(c.x-b.x).toBeGreaterThanOrEqual(280)
  const separate=layoutMap(fixture())
  expect(separate[1].y-separate[0].y).toBeGreaterThanOrEqual(160)
})

test('workflow request treats node links as current execution dependencies, excluding inactive corrections', () => {
  const spec: any = { name: 'ccdproc', title: 'CCD', parameters: [], inputs: [{name:'images',label:'영상',multiple:true,kind:'image'},{name:'zero',label:'Bias',multiple:false,kind:'image'}], output:{name:'output',mode:'each',default:'p'},kind:'image' }
  const cat: any = { tasks:[spec], ccdproc:{parameters:[],inputs:[]}, ccdred:[], exam:{} }
  const pref: any = {drafts:{},backend:'cl',mapping:{},instrument:[],packageValues:{}}
  const a=makeInstance(spec,cat,pref,'a'), b=makeInstance(spec,cat,pref,'b')
  b.draft.parameters.zerocor='no'
  let m=addTask(addTask(emptyMap(),a),b)
  m=connect(m,'b','images',{kind:'result',taskId:'a',runId:'old',ids:['old-file']},false)
  m=connect(m,'b','zero',{kind:'pending',taskId:'a'},false)
  const request=workflowRequest(m,cat,'/data')
  expect(request.links.map((l:any)=>l.role)).toEqual(['images'])
  expect(request.nodes[1].payload.inputs.images).toEqual([])
  expect(request.nodes[1].payload.workingDirectory).toBe('/data')
})
