import { expect, test } from "bun:test"
import { addTask, emptyMap, makeInstance, uid, type Instance, type TaskMap } from "../src/lib/task-map"
import { connectFlow } from "../src/lib/workflow-flow"
import { holdPset, takeOutPset } from "../src/lib/values"
import { psetSources, setValueMode, valueDescription, valueIssues } from "../src/lib/value-modes"
import { withObject, withSubject } from "../src/lib/korean"
import type { Catalog, Param, Preferences, Spec } from "../src/lib/workbench"

const param = (name: string, type: string): Param =>
  ({ name, type, default: type === "r" ? 1 : "", choices: [], prompt: "", min: "", max: "" })
const datapars = { name: "datapars", task: "daophot.datapars", parameters: [param("fwhmpsf", "r"), param("gain", "s")] }
const task = (name: string, extra: Partial<Spec> = {}): Spec => ({
  name: `noao.digiphot.daophot.${name}`, title: name, taskName: name, package: "daophot", adapter: "generic",
  parameters: [param("verify", "b")], parameterSets: [datapars],
  inputs: [{ name: "image", label: "image", kind: "image", multiple: true }],
  outputs: [{ name: "output", kind: "text", default: "default" }], output: null, kind: "text", ...extra,
})
const phot = task("phot", { pinned: ["datapars.fwhmpsf"], parameterSets: [datapars, { name: "photpars", task: "daophot.photpars", parameters: [param("apertures", "s")] }] })
const daofind = task("daofind")
const node = (name: string, run: Spec["run"], title: string, extra: Partial<Spec> = {}): Spec => ({
  name, title, taskName: title, package: "giraf", adapter: "generic", run, parameters: [], inputs: [], outputs: [], output: null, kind: "any", ...extra,
})
const value = node("giraf.value", "value-constant", "값")
const header = node("giraf.header", "value-header", "헤더 값", {
  inputs: [{ name: "files", label: "파일", kind: "image", multiple: true, required: true }],
})
const compute = node("giraf.compute", "value-compute", "계산")
const pset = node("giraf.pset", "pset", "pset")
const catalog: Catalog = {
  version: "test",
  tasks: [phot, daofind, value, header, compute, pset],
  ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {},
}
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const make = (spec: Spec, id: string, patch: Partial<Instance> = {}) => ({ ...makeInstance(spec, catalog, prefs, id), ...patch })
const draftOf = (spec: Spec, patch: Partial<Instance["draft"]>) => ({ ...makeInstance(spec, catalog, prefs).draft, ...patch })
const link = (map: TaskMap, source: string, sourceHandle: string, target: string, targetHandle: string) =>
  connectFlow(map, catalog, [], { source, sourceHandle, target, targetHandle })
const find = (map: TaskMap, id: string) => map.tasks.find((t) => t.id === id)!
const links = (map: TaskMap) =>
  map.connections.map((c) => `${c.source.kind === "files" ? "files" : `${c.source.taskId}.${c.source.outputRole}`} > ${c.target}.${c.role}`)

function fixture(): TaskMap {
  let map = emptyMap()
  map = addTask(map, make(phot, "phot", { position: { x: 600, y: 0 } }))
  map = addTask(map, make(daofind, "find", { position: { x: 600, y: 300 } }))
  map = addTask(map, make(value, "v", {
    label: "값", position: { x: 0, y: 0 },
    draft: draftOf(value, { valueRows: [{ name: "gain", value: "1.4" }], partition: "FILTER", partitionValues: ["B"] }),
  }))
  return link(map, "v", "value:gain", "phot", "p:datapars.gain")
}

test("switching 가져오기 keeps the node and drops the links its rows carried", () => {
  const map = fixture()
  expect(setValueMode(map, catalog, "v", "value-constant")).toBe(map)
  const next = setValueMode(map, catalog, "v", "value-header")
  const node = find(next, "v")
  expect([node.id, node.task, node.label, node.position]).toEqual(["v", "giraf.header", "값", { x: 0, y: 0 }])
  expect([node.draft.valueRows, node.draft.partition, node.draft.partitionValues]).toEqual([undefined, undefined, undefined])
  expect(links(next)).toEqual([])
  // The phot side keeps the parameter it pinned.
  expect(find(next, "phot").pinned).toContain("datapars.gain")
})

test("a chosen label stays; a default one, numbered or not, becomes 값", () => {
  let map = fixture()
  map = { ...map, tasks: map.tasks.map((t) => (t.id === "v" ? { ...t, label: "게인" } : t)) }
  expect(find(setValueMode(map, catalog, "v", "value-compute"), "v").label).toBe("게인")
  map = addTask(map, make(header, "h", { label: "헤더 값 2" }))
  expect(find(setValueMode(map, catalog, "h", "value-compute"), "h").label).toBe("값 2")
  expect(() => setValueMode(map, catalog, "phot", "value-header")).toThrow()
})

test("links into a node go when it no longer has the handle", () => {
  let map = fixture()
  map = addTask(map, make(compute, "c", { draft: draftOf(compute, { valueRows: [{ name: "g2", value: "gain * 2" }] }) }))
  map = link(map, "v", "value:gain", "c", "p:gain")
  map = addTask(map, make(header, "h"))
  map = { ...map, connections: [...map.connections, { id: uid(), target: "h", role: "files", source: { kind: "files", ids: ["a"], label: "" } }] }
  const computed = setValueMode(map, catalog, "c", "value-header")
  expect(links(computed)).toEqual(["v.value:gain > phot.p:datapars.gain", "files > h.files"])
  // A header node's file input fits no other 가져오기.
  expect(links(setValueMode(map, catalog, "h", "value-constant"))).toEqual(["v.value:gain > phot.p:datapars.gain", "v.value:gain > c.p:gain"])
})

test("into 작업 설정: empty until a task and pset are chosen, then filled like taking it out", () => {
  let map = fixture()
  map = { ...map, tasks: map.tasks.map((t) => t.id === "phot" ? { ...t, parameterSets: { ...t.parameterSets, datapars: { ...t.parameterSets!.datapars, fwhmpsf: 3.2 } } } : t) }
  const empty = setValueMode(map, catalog, "v", "pset")
  expect([find(empty, "v").task, find(empty, "v").label, find(empty, "v").draft.pset]).toEqual(["giraf.pset", "값", undefined])
  expect(valueIssues(empty, catalog).map((i) => [i.nodeId, i.severity, i.message, i.label])).toEqual([["v", "warning", "가져올 작업과 pset을 골라 주세요.", "값"]])
  expect(psetSources(empty, catalog).map((s) => [s.task.id, s.sets])).toEqual([["phot", ["datapars", "photpars"]], ["find", ["datapars"]]])

  const held = holdPset(empty, catalog, "v", "phot", "datapars")
  const node = find(held, "v")
  expect([node.label, node.draft.pset, node.parameterSets?.datapars.fwhmpsf, node.pinned]).toEqual([
    "datapars", { name: "datapars", task: "daophot.datapars" }, 3.2, ["datapars.fwhmpsf", "datapars.gain"],
  ])
  // The task's pinned pset parameters move to the node.
  expect(find(held, "phot").pinned).toEqual([])
  expect(links(held)).toEqual(["v.pset > phot.pset:datapars"])
  expect(valueIssues(held, catalog)).toEqual([])
})

test("another task's same pset keeps the tasks it feeds and leads them", () => {
  let map = takeOutPset(fixture(), catalog, "phot", "datapars")
  const id = map.tasks.at(-1)!.id
  map = link(map, id, "pset", "find", "pset:datapars")
  // A value moved into the node with the pset stays with it.
  expect(links(map)).toEqual([`v.value:gain > ${id}.p:datapars.gain`, `${id}.pset > phot.pset:datapars`, `${id}.pset > find.pset:datapars`])
  expect(valueDescription(map, catalog, find(map, id))).toBe("phot의 datapars를 여러 작업에 전달")
  map = holdPset(map, catalog, id, "find", "datapars")
  expect(links(map)).toEqual([`v.value:gain > ${id}.p:datapars.gain`, `${id}.pset > find.pset:datapars`, `${id}.pset > phot.pset:datapars`])
  expect(valueDescription(map, catalog, find(map, id))).toBe("daofind의 datapars를 여러 작업에 전달")
})

test("out of 작업 설정: the pset and its links go", () => {
  let map = takeOutPset(fixture(), catalog, "phot", "datapars")
  const id = map.tasks.at(-1)!.id
  map = setValueMode(map, catalog, id, "value-constant")
  const node = find(map, id)
  expect([node.task, node.label, node.draft.pset, node.parameterSets, node.pinned]).toEqual(["giraf.value", "값", undefined, {}, undefined])
  expect(links(map)).toEqual([])
})

test("the line under a 값 node says what it hands on", () => {
  const map = fixture()
  const describe = (spec: Spec, draft: Partial<Instance["draft"]> = {}) =>
    valueDescription(map, catalog, make(spec, "x", { draft: draftOf(spec, draft) }))
  expect(describe(value)).toBe("직접 정한 값을 전달")
  expect(describe(value, { partition: "FILTER" })).toBe("직접 정한 값을 FILTER별로 전달")
  expect(describe(header)).toBe("파일 헤더의 키워드 값을 전달")
  expect(describe(compute)).toBe("받은 값을 계산해 전달")
  expect(describe(compute, { partition: "FILTER" })).toBe("받은 값을 FILTER별로 계산해 전달")
  expect(describe(pset)).toBe("작업 설정을 여러 작업에 전달")
  expect(describe(pset, { pset: { name: "photpars", task: "daophot.photpars" } })).toBe("photpars를 여러 작업에 전달")
  expect(valueDescription(map, catalog, find(map, "phot"))).toBeUndefined()
})

test("object and subject particles follow the word's last sound", () => {
  expect(["datapars", "param", "파일", "데이터", "값", "3", "2", "ring"].map(withObject)).toEqual([
    "datapars를", "param을", "파일을", "데이터를", "값을", "3을", "2를", "ring을",
  ])
  expect(["숫자", "파일 이름", "FILTER 값"].map(withSubject)).toEqual(["숫자가", "파일 이름이", "FILTER 값이"])
})
