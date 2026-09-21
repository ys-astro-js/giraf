// Regression contracts written before implementation.
import { expect, test } from "bun:test"
import {
  addTask,
  connect,
  emptyMap,
  makeInstance,
  publishRun,
  removeLibraryReferences,
} from "../src/lib/task-map"
import {
  connectionChoices,
  nodeOutput,
  nodeGeometry,
  nodeLayout,
  fitNodes,
} from "../src/lib/node-interaction"
import { plannedOutputs } from "../src/lib/workbench"
import { editableOutputPorts } from "../src/lib/output-ports"
import { outputPorts } from "../src/lib/calibration-ports"
import { connectFlow, flowEdges } from "../src/lib/workflow-flow"
import type { Catalog, Preferences, Spec, Frame } from "../src/lib/workbench"
const image: Spec = {
  name: "ccdproc",
  title: "CCD 보정",
  package: "ccdred",
  parameters: [],
  inputs: [
    { name: "images", label: "보정할 영상", kind: "image", multiple: true },
    { name: "zero", label: "Bias 영상", kind: "image", multiple: false },
    { name: "fixfile", label: "불량 픽셀", kind: "text", multiple: false },
  ],
  output: { name: "output", mode: "each", default: "p_" },
  kind: "image",
}
const combine: Spec = {
  ...image,
  name: "zerocombine",
  title: "Bias 결합",
  inputs: [
    { name: "input", label: "결합할 영상", kind: "image", multiple: true },
  ],
  output: { name: "output", mode: "single", default: "zero" },
  preprocess: false,
}
const textSpec: Spec = {
  ...combine,
  name: "imstatistics",
  kind: "text",
  output: null,
}
const catalog: Catalog = {
  version: "test",
  tasks: [image, combine, textSpec],
  ccdproc: { parameters: [], inputs: image.inputs },
  ccdred: [],
  exam: {},
}
const prefs: Preferences = {
  drafts: {},
  backend: "cl",
  mapping: {},
  instrument: [],
  packageValues: {},
}
function fixture() {
  let m = emptyMap()
  for (const [s, id] of [
    [combine, "a"],
    [image, "b"],
    [combine, "c"],
    [textSpec, "text"],
  ] as const)
    m = addTask(m, makeInstance(s, catalog, prefs, id))
  return m
}
const product = (id: string, asset = "image"): Frame => ({
  id,
  label: id + ".fits",
  asset,
})
test("output connections infer the node output before its first run", () => {
  expect(nodeOutput(fixture(), "a")).toEqual({ kind: "pending", taskId: "a" })
})
test("latest completed output includes all reusable products and run provenance", () => {
  let m = publishRun(fixture(), "a", {
    id: "r1",
    state: "completed",
    products: [product("old")],
  })
  m = publishRun(m, "a", {
    id: "r2",
    state: "completed",
    products: [
      product("one"),
      product("two"),
      product("plot", "plot"),
      product("report", "text"),
    ],
  })
  expect(nodeOutput(m, "a")).toEqual({
    kind: "result",
    taskId: "a",
    runId: "r2",
    ids: ["one", "two"],
  })
})
test("single active compatible input is the only choice; inactive corrections excluded", () => {
  expect(
    connectionChoices(
      fixture(),
      catalog,
      { kind: "pending", taskId: "a" },
      "b",
      []
    ).map((s) => s.name)
  ).toEqual(["images"])
})
test("multiple active compatible inputs remain choices without changing the map", () => {
  const m = fixture()
  m.tasks.find((t) => t.id === "b")!.draft.parameters.zerocor = "yes"
  expect(
    connectionChoices(
      m,
      catalog,
      { kind: "pending", taskId: "a" },
      "b",
      []
    ).map((s) => s.name)
  ).toEqual(["images", "zero"])
  expect(m.connections).toEqual([])
})
test("text output cannot feed an image input", () => {
  expect(() =>
    connectionChoices(
      fixture(),
      catalog,
      { kind: "pending", taskId: "text" },
      "c",
      []
    )
  ).toThrow("입력")
})
test("known multiple outputs cannot silently become a scalar input", () => {
  let m = fixture()
  m.tasks.find((t) => t.id === "b")!.draft.parameters.zerocor = "yes"
  m = publishRun(m, "a", {
    id: "r",
    state: "completed",
    products: [product("x"), product("y")],
  })
  expect(
    connectionChoices(m, catalog, nodeOutput(m, "a"), "b", []).map(
      (s) => s.name
    )
  ).toEqual(["images"])
})
test("self links and cycle targets are rejected before connection", () => {
  let m = fixture()
  expect(() =>
    connectionChoices(m, catalog, { kind: "pending", taskId: "a" }, "a", [])
  ).toThrow()
  m = connect(m, "b", "images", { kind: "pending", taskId: "a" })
  expect(() =>
    connectionChoices(m, catalog, { kind: "pending", taskId: "b" }, "a", [])
  ).toThrow("순환")
})
test("deleted and malformed sources fail without changing the map", () => {
  const m = fixture()
  expect(() =>
    connectionChoices(m, catalog, { kind: "pending", taskId: "gone" }, "b", [])
  ).toThrow()
  expect(() =>
    connectionChoices(
      m,
      catalog,
      { kind: "files", ids: ["missing"], label: "x" },
      "b",
      []
    )
  ).toThrow()
  expect(m.connections).toEqual([])
})
test("reconnecting preserves other inputs and clears only the role expression", () => {
  let m = fixture()
  m.tasks.find((t) => t.id === "b")!.expressions.images = "@old"
  m = connect(m, "b", "zero", { kind: "files", ids: ["bias"], label: "bias" })
  m = connect(m, "b", "images", { kind: "pending", taskId: "a" }, false)
  expect(m.tasks.find((t) => t.id === "b")!.expressions.images).toBe("")
  expect(m.connections.find((c) => c.role === "zero")?.source).toMatchObject({
    ids: ["bias"],
  })
})
test("role ports have separate anchors and output remains below inputs", () => {
  const m = fixture()
  m.tasks.find((t) => t.id === "b")!.draft.parameters.zerocor = "yes"
  const g = nodeGeometry(
    m,
    m.tasks.find((t) => t.id === "b")!,
    catalog
  )
  expect(g.inputY("zero")).toBeGreaterThan(g.inputY("images"))
  expect(g.outputY).toBeGreaterThan(g.inputY("zero"))
  expect(g.height-24).toBe(g.outputY)
})
test("layout accounts for variable heights and preserves manual positions", () => {
  const m = fixture()
  m.tasks[0].position = { x: 777, y: 333 }
  expect(nodeLayout(m, catalog)[0]).toMatchObject({ x: 777, y: 333 })
  m.tasks[0].position = { x: 40, y: 40 }
  m.tasks[1].position = { x: 40, y: 240 }
  const repaired = nodeLayout(m, catalog)
  expect(repaired[1].y).toBeGreaterThan(repaired[0].y + repaired[0].height)
  const auto = nodeLayout(
    { ...m, tasks: m.tasks.map((t) => ({ ...t, position: undefined })) },
    catalog
  )
  for (let i = 1; i < auto.length; i++)
    expect(auto[i].y).toBeGreaterThanOrEqual(
      auto[i - 1].y + nodeGeometry(m, m.tasks[i - 1], catalog).height
    )
})
test("fit includes complete cards at narrow sizes", () => {
  const p = nodeLayout(fixture(), catalog),
    f = fitNodes(p, 320, 480)
  expect(f.zoom).toBeGreaterThan(0)
  for (const n of p) {
    expect((n.x + n.width) * f.zoom).toBeLessThanOrEqual(320)
    expect((n.y + n.height) * f.zoom).toBeLessThanOrEqual(480)
  }
})
test("compact node geometry keeps each wire at its input row center", () => {
 const m=fixture(); m.tasks[1].draft.parameters.zerocor="yes";
 const g=nodeGeometry(m,m.tasks[1],catalog);
 expect(g.inputY("images")).toBe(96);
 expect(g.inputY("zero")).toBe(144);
 expect(g.height).toBe(224);
 expect(g.outputY).toBe(200);
 expect(g.outputs).toHaveLength(0);
});

test('generic inputs stay visible while unused optional outputs stay compact after reload', () => {
  const spec: Spec = {...combine, name:'images.immatch.imcombine', adapter:'generic', output:null,
    inputs:[{name:'input', label:'Input', kind:'image', multiple:true, required:true}, {name:'aux',label:'Optional',kind:'text',multiple:false,required:false}],
    outputs:[{name:'output',kind:'image',default:'combined.fits'}, {name:'nrejmasks',kind:'mask',default:'',optional:true}]}
  const cat = {...catalog, tasks:[...catalog.tasks,spec]}
  const task = makeInstance(spec,cat,prefs,'combine')
  let map = addTask(emptyMap(),task)
  const compact = nodeGeometry(map,task,cat)
  expect(compact.roles.map(s=>s.name)).toEqual(['input','aux'])
  expect(compact.outputs.map(s=>s.name)).toEqual([])
  expect(compact.primaryOutputRole).toBe("output")
  expect(editableOutputPorts(task,spec,map).map(p=>p.id)).toEqual(['$default'])
  expect(outputPorts(map,task,cat,[]).map(p=>p.outputRole)).toEqual([])
  spec.outputs![0].mode = 'single'
  spec.outputs![0].eachWhen = 'project'
  task.draft.inputs.input = ['a','b']
  task.draft.parameters.project = 'no'
  expect(plannedOutputs(spec,task.draft,[])).toHaveLength(1)
  task.draft.parameters.project = 'yes'
  expect(plannedOutputs(spec,task.draft,[])).toHaveLength(2)
  const restored = JSON.parse(JSON.stringify(map))
  expect(nodeGeometry(restored,restored.tasks[0],cat).height).toBe(compact.height)
  task.draft.inputs.aux = ['file']
  task.draft.outputs!.nrejmasks = 'rejected.pl'
  expect(nodeGeometry(map,task,cat).roles.map(s=>s.name)).toEqual(['input','aux'])
  expect(nodeGeometry(map,task,cat).outputs.map(s=>s.name)).toEqual(['nrejmasks'])
  expect(editableOutputPorts(task,spec,map).map(p=>p.id)).toEqual(['$default','$role:nrejmasks'])
  task.outputPorts=[{id:'$role:nrejmasks',name:'Rejected',files:['*']},{id:'custom',name:'Selected',files:['*B.fits']}]
  task.draft.outputs!.nrejmasks=''
  expect(editableOutputPorts(task,spec,map).map(p=>p.id)).toEqual(['$default','custom'])
  map.connections.push({id:'old',target:'other',role:'input',source:{kind:'pending',taskId:task.id,outputRole:'nrejmasks'}})
  expect(editableOutputPorts(task,spec,map).map(p=>p.id)).toEqual(['$default','$role:nrejmasks','custom'])
  map.connections.push({id:'default',target:'other',role:'input',source:{kind:'pending',taskId:task.id}})
  expect(nodeGeometry(map,task,cat).primaryOutputRole).toBe('output')
  expect(editableOutputPorts(task,spec,map)[0]).toMatchObject({name:'',outputRole:'output'})
  const target=makeInstance(spec,cat,prefs,'other')
  const linked=connectFlow(addTask({...map,connections:[]},target),cat,[],{source:task.id,target:target.id,sourceHandle:'output',targetHandle:'input'})
  expect(linked.connections[0].source).toMatchObject({kind:'pending',outputRole:'output'})
  const completed=publishRun(linked,task.id,{id:'finished',state:'completed',products:[{...product('main'),role:'output'},{...product('sigma'),role:'sigmas'}]})
  const wire=connectFlow({...completed,connections:[]},cat,[],{source:task.id,target:target.id,sourceHandle:'output',targetHandle:'input'})
  expect(wire.connections[0].source).toMatchObject({outputRole:'output',ids:['main']})
  expect(flowEdges(linked,cat)[0].sourceHandle).toBe('output')
  linked.connections[0].source={kind:'pending',taskId:task.id,outputRole:'output',port:'output:output'}
  expect(flowEdges(linked,cat)[0].sourceHandle).toBe('output')
})

test('clearing or deleting input files removes empty references before connecting another node', () => {
  let map=fixture()
  map=connect(map,'b','images',{kind:'files',ids:['gone'],label:'Files'},false)
  map=connect(map,'b','images',{kind:'files',ids:[],label:''},false)
  expect(map.connections.filter(c=>c.target==='b'&&c.role==='images')).toHaveLength(0)
  // Older saved maps may contain these empty selections.
  map.connections.push({id:'empty',target:'b',role:'images',source:{kind:'files',ids:[],label:''}})
  map=connect(map,'b','images',{kind:'pending',taskId:'a'})
  expect(map.connections.some(c=>c.id==='empty')).toBe(false)
  map=connect(map,'b','images',{kind:'files',ids:['gone','keep'],label:'Files'})
  map.tasks.find(t=>t.id==='b')!.draft.inputs.zero=['gone']
  map.tasks.find(t=>t.id==='b')!.preprocess.inputs.dark=['gone','keep']
  const cleaned=removeLibraryReferences(map,new Set(['gone']),new Set())
  expect(cleaned.tasks.find(t=>t.id==='b')!.draft.inputs.zero).toEqual([])
  expect(cleaned.tasks.find(t=>t.id==='b')!.preprocess.inputs.dark).toEqual(['keep'])
  expect(cleaned.connections.find(c=>c.source.kind==='files')?.source).toMatchObject({ids:['keep']})
  const empty=removeLibraryReferences(cleaned,new Set(['keep']),new Set())
  expect(empty.connections).toHaveLength(1)
  expect(empty.connections[0].source).toMatchObject({kind:'pending',taskId:'a'})
  expect(map.connections.find(c=>c.source.kind==='files')?.source).toMatchObject({ids:['gone','keep']})
  const withResult=publishRun(empty,'a',{id:'job',state:'completed',products:[product('result')]})
  withResult.connections[0].source={kind:'result',taskId:'a',runId:'job',ids:['result']}
  const withoutJob=removeLibraryReferences(withResult,new Set(['result']),new Set(['job']))
  expect(withoutJob.runs).toHaveLength(0)
  expect(withoutJob.connections[0].source).toMatchObject({kind:'pending',taskId:'a'})
})
