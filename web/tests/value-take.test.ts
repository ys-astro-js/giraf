import { expect, test } from "bun:test"
import { addTask, emptyMap, makeInstance, type Instance, type TaskMap } from "../src/lib/task-map"
import { holdPset, takeOutPset } from "../src/lib/values"
import { nextValueLabel, parameterLink, takesValue, takeValue } from "../src/lib/value-take"
import { nodeLayout, NODE_WIDTH } from "../src/lib/node-interaction"
import type { Catalog, Param, Preferences, Spec } from "../src/lib/workbench"

const param = (name: string, type: string, extra: Partial<Param> = {}): Param =>
  ({ name, type, default: type === "r" ? 2.5 : "", choices: [], prompt: "", min: "", max: "", ...extra })
const datapars = { name: "datapars", task: "daophot.datapars", parameters: [param("fwhmpsf", "r"), param("gain", "s")] }
const task = (name: string): Spec => ({
  name: `noao.digiphot.daophot.${name}`, title: name, taskName: name, package: "daophot", adapter: "generic",
  parameters: [param("verify", "b", { default: "no" }), param("scale", "r"), param("graphics", "*gcur"), param("image", "f", { connectable: false })],
  parameterSets: [datapars],
  inputs: [{ name: "image", label: "image", kind: "image", multiple: true }],
  outputs: [{ name: "output", kind: "text", default: "default" }], output: null, kind: "text",
})
const phot = task("phot")
const daofind = task("daofind")
const node = (name: string, run: Spec["run"], title: string): Spec => ({
  name, title, taskName: title, package: "giraf", adapter: "generic", run, parameters: [], inputs: [], outputs: [], output: null, kind: "any",
})
const value = node("giraf.value", "value-constant", "값")
const pset = node("giraf.pset", "pset", "pset")
const catalog: Catalog = {
  version: "test",
  tasks: [phot, daofind, value, pset],
  ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {},
}
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const make = (spec: Spec, id: string, patch: Partial<Instance> = {}) => ({ ...makeInstance(spec, catalog, prefs, id), ...patch })
const find = (map: TaskMap, id: string) => map.tasks.find((t) => t.id === id)!
// Where the canvas draws a node: a saved position, else the automatic layout.
const drawn = (map: TaskMap, id: string) => {
  const i = map.tasks.findIndex((t) => t.id === id)
  return { ...nodeLayout(map, catalog)[i], ...map.tasks[i].position }
}
const level = (map: TaskMap, id: string, key: string) => {
  const v = drawn(map, id), t = drawn(map, map.connections.find((c) => c.source.kind !== "files" && c.source.taskId === id)!.target)
  return [v.y + v.values[0].y, t.y + t.params.find((p) => p.key === key)!.y]
}
const fixture = () => {
  let map = emptyMap()
  map = addTask(map, make(phot, "phot", { position: { x: 600, y: 0 } }))
  map = addTask(map, make(daofind, "find", { position: { x: 600, y: 400 } }))
  return map
}

test("only parameters a value output can reach take a value", () => {
  const [verify, scale, graphics, image] = phot.parameters
  expect([verify, scale, graphics, image].map(takesValue)).toEqual([true, true, false, false])
})

test("a parameter takes its current value from a new 직접 입력 값 node", () => {
  let map = fixture()
  map = { ...map, tasks: map.tasks.map((t) => (t.id === "phot" ? { ...t, draft: { ...t.draft, parameters: { ...t.draft.parameters, scale: "1.5" } } } : t)) }
  const next = takeValue(map, catalog, "phot", "scale", [], "v")
  const created = find(next, "v")
  expect(created.task).toBe("giraf.value")
  expect(created.label).toBe("값")
  expect(created.draft.valueRows).toEqual([{ name: "scale", value: "1.5" }])
  expect(find(next, "phot").pinned).toContain("scale")
  expect(parameterLink(next, "phot", "scale")?.source).toMatchObject({ taskId: "v", outputRole: "value:scale" })
  expect(next.view.selected).toBe("v")
  // Left of the task, its value row level with the parameter's row, clear of other nodes.
  expect(created.position!.x).toBe(600 - NODE_WIDTH - 80)
  const [row, param] = level(next, "v", "scale")
  expect(row).toBe(param)
  // The next one is numbered with the other 값 nodes.
  expect(nextValueLabel(next, catalog)).toBe("값 2")
  const second = takeValue(next, catalog, "phot", "verify", [], "w")
  expect(find(second, "w").label).toBe("값 2")
  expect(find(second, "w").draft.valueRows).toEqual([{ name: "verify", value: "no" }])
  // Same row height, so it moves further left instead of overlapping the first.
  const w = find(second, "w").position!, v = find(second, "v").position!
  expect(w.x + NODE_WIDTH <= v.x || w.y >= v.y + 100 || w.y + 100 <= v.y).toBe(true)
})

test("a parameter without a value gets an empty row, still connected", () => {
  const next = takeValue(fixture(), catalog, "phot", "datapars.gain", [], "v")
  expect(find(next, "v").draft.valueRows).toEqual([{ name: "gain", value: "" }])
  expect(parameterLink(next, "phot", "datapars.gain")?.source).toMatchObject({ taskId: "v", outputRole: "value:gain" })
})

test("a pset fed by a 작업 설정 node takes the value on that node", () => {
  let map = takeOutPset(fixture(), catalog, "phot", "datapars")
  const psetId = map.tasks.find((t) => t.task === "giraf.pset")!.id
  map = holdPset(map, catalog, psetId, "find", "datapars")
  map = takeOutPset(map, catalog, "phot", "datapars")
  // takeOutPset made a second node; use the first, which feeds both tasks.
  map = holdPset(map, catalog, psetId, "phot", "datapars")
  map = {
    ...map,
    tasks: map.tasks.map((t) => (t.id === psetId ? { ...t, parameterSets: { datapars: { fwhmpsf: "3.2", gain: "" } } } : t)),
  }
  const next = takeValue(map, catalog, "phot", "datapars.fwhmpsf", [], "v")
  const role = "p:datapars.fwhmpsf"
  expect(next.connections.filter((c) => c.role === role).map((c) => c.target)).toEqual([psetId])
  expect(find(next, psetId).pinned).toContain("datapars.fwhmpsf")
  expect(find(next, "phot").pinned ?? []).not.toContain("datapars.fwhmpsf")
  expect(find(next, "v").draft.valueRows).toEqual([{ name: "fwhmpsf", value: "3.2" }])
  // Both tasks sharing the pset see the same connection.
  expect(parameterLink(next, "phot", "datapars.fwhmpsf")).toBe(parameterLink(next, "find", "datapars.fwhmpsf"))
  const [row, param] = level(next, "v", "datapars.fwhmpsf")
  expect(row).toBe(param)
})

test("the node lines up with where the task is drawn, even over another node", () => {
  // A saved position overlapping an earlier node is drawn as saved, not pushed down.
  let map = fixture()
  map = { ...map, tasks: map.tasks.map((t) => (t.id === "find" ? { ...t, position: { x: 620, y: 20 } } : t)) }
  const next = takeValue(map, catalog, "find", "scale", [], "v")
  const [row, param] = level(next, "v", "scale")
  expect(row).toBe(param)
})

test("a task drawn by the automatic layout keeps its place", () => {
  let map = fixture()
  map = { ...map, tasks: map.tasks.map((t) => ({ ...t, position: undefined })) }
  const before = drawn(map, "phot")
  const next = takeValue(map, catalog, "phot", "scale", [], "v")
  expect(find(next, "phot").position).toEqual({ x: before.x, y: before.y })
  const [row, param] = level(next, "v", "scale")
  expect(row).toBe(param)
})

test("a parameter that takes no value connection is refused", () => {
  expect(() => takeValue(fixture(), catalog, "phot", "image")).toThrow("값을 연결받지 않는")
  expect(() => takeValue(fixture(), catalog, "phot", "graphics")).toThrow()
})
