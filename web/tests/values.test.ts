import { expect, test } from "bun:test"
import { addTask, emptyMap, makeInstance, payloadFor, workflowRequest, workflowDiagnosticRequest, type Instance, type TaskMap } from "../src/lib/task-map"
import { nodeGeometry, NODE_METRICS } from "../src/lib/node-interaction"
import { connectFlow, connectionFeedback, flowNodes, taskEdges } from "../src/lib/workflow-flow"
import {
  computeVariables,
  expressionNames,
  formatValue,
  pinnedKeys,
  psetValues,
  takeOutPset,
  valueRequest,
} from "../src/lib/values"
import type { Catalog, Param, Preferences, Spec } from "../src/lib/workbench"

const param = (name: string, type: string, extra: Partial<Param> = {}): Param =>
  ({ name, type, default: type === "r" ? 1 : "", choices: [], prompt: "", min: "", max: "", ...extra })
const datapars = { name: "datapars", task: "daophot.datapars", parameters: [param("fwhmpsf", "r"), param("exposure", "s", { connectable: false }), param("emission", "b")] }
const phot: Spec = {
  name: "noao.digiphot.daophot.phot", title: "phot", package: "daophot", adapter: "generic",
  parameters: [param("verify", "b")],
  parameterSets: [datapars, { name: "photpars", task: "daophot.photpars", parameters: [param("apertures", "s")] }],
  inputs: [{ name: "image", label: "image", kind: "image", multiple: true }],
  outputs: [{ name: "output", kind: "text", default: "default" }],
  output: null, kind: "text", pinned: ["datapars.fwhmpsf"],
}
const daoedit: Spec = {
  name: "noao.digiphot.daophot.daoedit", title: "daoedit", package: "daophot", adapter: "generic",
  parameters: [], inputs: [{ name: "image", label: "image", kind: "image", multiple: false }],
  outputs: [{ name: "$stdout", kind: "text", default: "" }], output: null, kind: "text",
  values: [{ name: "fwhm", kind: "real", from: "$stdout", column: "FWHM" }],
}
const node = (name: string, run: Spec["run"]): Spec => ({
  name, title: name, package: "giraf", adapter: "generic", run, parameters: [], inputs: [], outputs: [], output: null, kind: "any",
})
const catalog: Catalog = {
  version: "test",
  tasks: [phot, daoedit, node("giraf.value", "value-constant"), node("giraf.compute", "value-compute"), node("giraf.pset", "pset")],
  ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {},
}
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const make = (spec: Spec, id: string, patch: Partial<Instance> = {}) => ({ ...makeInstance(spec, catalog, prefs, id), ...patch })

function fixture(): TaskMap {
  let map = emptyMap()
  map = addTask(map, make(phot, "phot", { position: { x: 600, y: 0 } }))
  map = addTask(map, make(daoedit, "edit", { position: { x: 0, y: 0 } }))
  map = addTask(map, make(catalog.tasks[3], "calc", { draft: { ...make(catalog.tasks[3], "x").draft, valueRows: [{ name: "m", value: "median(fwhm) * 4" }] } }))
  map = addTask(map, make(catalog.tasks[2], "gain", { draft: { ...make(catalog.tasks[2], "y").draft, valueRows: [{ name: "gain", value: "1.4" }, { name: "label", value: "B" }] } }))
  return map
}
const link = (map: TaskMap, source: string, sourceHandle: string, target: string, targetHandle: string) =>
  connectFlow(map, catalog, [], { source, sourceHandle, target, targetHandle })

test("new instances pin the schema's parameters and the params section shifts outputs", () => {
  const map = fixture()
  const task = map.tasks[0]
  expect(task.pinned).toEqual(["datapars.fwhmpsf"])
  const pinned = nodeGeometry(map, task, catalog)
  const bare = nodeGeometry(map, { ...task, pinned: [] }, catalog)
  const m = NODE_METRICS
  expect(pinned.params.map((p) => p.handleId)).toEqual(["p:datapars.fwhmpsf"])
  const inputsEnd = 1 + m.header + m.sectionStart + m.row + m.sectionEnd
  expect(pinned.params[0].y).toBe(inputsEnd + m.sectionStart + m.row / 2)
  expect(pinned.outputY - bare.outputY).toBe(m.sectionStart + m.row + m.sectionEnd)
  expect(pinned.height - bare.height).toBe(m.sectionStart + m.row + m.sectionEnd)
  // Handles in flowNodes come from the same geometry.
  const handles = flowNodes(map, catalog).find((n) => n.id === "phot")!.handles!
  expect(handles.find((h) => h.id === "p:datapars.fwhmpsf")!.y).toBe(pinned.params[0].y)
  // A value node has no file input or primary output; its value rows are outputs.
  const gain = nodeGeometry(map, map.tasks[3], catalog)
  expect([gain.showInputs, gain.primary]).toEqual([false, false])
  expect(gain.values.map((v) => [v.handleId, v.kind])).toEqual([["value:gain", "real"], ["value:label", "string"]])
  expect(gain.values[0].y).toBe(1 + m.header + m.sectionStart + m.row / 2)
})

test("value connections go only from value outputs to matching parameters", () => {
  let map = fixture()
  map = link(map, "edit", "value:fwhm", "calc", "p:fwhm")
  map = link(map, "calc", "value:m", "phot", "p:datapars.fwhmpsf")
  const value = map.connections.find((c) => c.target === "phot")!
  expect(value.role).toBe("p:datapars.fwhmpsf")
  expect(value.source).toEqual({ kind: "pending", taskId: "calc", outputRole: "value:m" })
  // A parameter takes one value: a new connection replaces the old one.
  const replaced = link(map, "gain", "value:gain", "phot", "p:datapars.fwhmpsf")
  expect(replaced.connections.filter((c) => c.target === "phot").map((c) => c.source)).toEqual([{ kind: "pending", taskId: "gain", outputRole: "value:gain" }])
  const refuse = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
    connectionFeedback(map, catalog, [], { source, sourceHandle, target, targetHandle })
  expect(refuse("gain", "value:label", "phot", "p:datapars.fwhmpsf").message).toContain("real")
  expect(refuse("gain", "value:gain", "phot", "p:datapars.exposure").message).toContain("연결받지 않는")
  expect(refuse("gain", "value:gain", "phot", "image").valid).toBe(false)
  expect(refuse("edit", "output", "phot", "p:datapars.fwhmpsf").valid).toBe(false)
  expect(refuse("phot", "value:gain", "calc", "p:fwhm").valid).toBe(false)
  // A value that loops back is refused.
  expect(refuse("calc", "value:m", "edit", "image").valid).toBe(false)
  // Connecting a parameter that is not pinned pins it.
  const pinnedNow = link(map, "gain", "value:label", "phot", "p:photpars.apertures")
  expect(pinnedKeys(pinnedNow, catalog, pinnedNow.tasks[0])).toEqual(["datapars.fwhmpsf", "photpars.apertures"])
  const edge = taskEdges(map, catalog).find((e) => e.target === "phot")!
  expect([edge.sourceHandle, edge.targetHandle, edge.className, edge.data?.value]).toEqual(["value:m", "p:datapars.fwhmpsf", "workflow-edge-value", true])
})

test("compute inputs are the names its expressions read", () => {
  expect(expressionNames("median(fwhm) * 4 + gain")).toEqual(["fwhm", "gain"])
  const calc = { ...fixture().tasks[2] }
  calc.draft = { ...calc.draft, valueRows: [{ name: "m", value: "median(fwhm)" }, { name: "n", value: "m * gain && !x" }] }
  expect(computeVariables(calc)).toEqual(["fwhm", "gain", "x"])
})

test("values resolve into the payload and the workflow request", () => {
  let map = fixture()
  map = link(map, "edit", "value:fwhm", "calc", "p:fwhm")
  map = link(map, "calc", "value:m", "phot", "p:datapars.fwhmpsf")
  map = { ...map, runs: [{ id: "run-edit", instanceId: "edit", state: "completed", products: [] }] }
  const request = valueRequest(map, catalog)
  expect(request.nodes.map((n) => [n.id, n.run, n.inputs])).toEqual([
    ["calc", "value-compute", { fwhm: { node: "edit", output: "fwhm" } }],
    ["gain", "value-constant", {}],
  ])
  expect(request.links).toEqual([{ id: map.connections.at(-1)!.id, target: "phot", parameter: "datapars.fwhmpsf", type: "r", source: { node: "calc", output: "m" } }])
  expect(request.runs).toEqual({ edit: "run-edit" })
  const payload = payloadFor(map, "phot", catalog, { "datapars.fwhmpsf": 8.1, verify: "no" })
  expect(payload.parameterSets.datapars.fwhmpsf).toBe(8.1)
  expect(payload.parameters.verify).toBe("no")
  // Value nodes never run as jobs; their links travel to the server instead.
  const workflow = workflowRequest(map, catalog, "/tmp")
  expect(workflow.nodes.map((n) => n.id)).toEqual(["phot", "edit"])
  expect(workflow.links).toEqual([])
  expect(workflow.values.links.map((l) => l.target)).toEqual(["phot"])
  expect(workflow.values.runs).toEqual({})
  const diagnostics = workflowDiagnosticRequest(map, catalog, "/tmp")
  expect(diagnostics.nodes.map((n) => n.id)).toEqual(["phot", "edit"])
  expect(diagnostics.connections).toEqual([])
})

test("a pset node shares one pset between tasks", () => {
  let map = fixture()
  map = addTask(map, make(phot, "find"))
  map = { ...map, tasks: map.tasks.map((t) => t.id === "phot" ? { ...t, parameterSets: { ...t.parameterSets, datapars: { ...t.parameterSets!.datapars, fwhmpsf: 3.2 } } } : t) }
  map = takeOutPset(map, catalog, "phot", "datapars")
  const pset = map.tasks.at(-1)!
  expect([pset.task, pset.label, pset.draft.pset, pset.pinned]).toEqual(["giraf.pset", "datapars", { name: "datapars", task: "daophot.datapars" }, ["datapars.fwhmpsf"]])
  expect(map.tasks.find((t) => t.id === "phot")!.pinned).toEqual([])
  map = link(map, pset.id, "pset", "find", "pset:datapars")
  expect(connectionFeedback(map, catalog, [], { source: pset.id, sourceHandle: "pset", target: "find", targetHandle: "pset:photpars" }).valid).toBe(false)
  for (const id of ["phot", "find"])
    expect(psetValues(map, map.tasks.find((t) => t.id === id)!).datapars.fwhmpsf).toBe(3.2)
  // A value into the pset node's parameter reaches both tasks.
  map = link(map, "gain", "value:gain", pset.id, "p:datapars.fwhmpsf")
  expect(valueRequest(map, catalog).links.map((l) => [l.target, l.parameter])).toEqual([["phot", "datapars.fwhmpsf"], ["find", "datapars.fwhmpsf"]])
  const geometry = nodeGeometry(map, map.tasks.find((t) => t.id === "find")!, catalog)
  expect(geometry.params.map((p) => p.handleId)).toEqual(["pset:datapars", "p:datapars.fwhmpsf"])
  expect(nodeGeometry(map, pset, catalog).psetOutput).toBe(true)
})

test("values format compactly for rows and labels", () => {
  expect(formatValue({ values: [3.2149] })).toBe("3.215")
  expect(formatValue({ values: [8.28, 8, 7.5, 9] })).toBe("8.28, 8 외 2개")
  expect(formatValue({ values: [3.38, 3.07], groups: { keyword: "FILTER", values: { B: [3.38], V: [3.07] } } })).toBe("B 3.38, V 3.07")
  expect(formatValue({ error: "x" })).toBe("")
})
