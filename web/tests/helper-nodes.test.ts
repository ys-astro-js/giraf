import { beforeAll, expect, test } from "bun:test"
import type { Edge } from "@xyflow/react"
import { addTask, emptyMap, makeInstance, migrateMap, type Instance, type TaskMap } from "../src/lib/task-map"
import { connectFlow, taskEdges } from "../src/lib/workflow-flow"
import { autoLayoutMap } from "../src/lib/workflow-layout"
import {
  bypassEdges,
  helperAnchors,
  helperKind,
  hiddenHelpers,
  migrateHelperView,
  peekedHelpers,
} from "../src/lib/helper-nodes"
import type { Catalog, Param, Preferences, Spec } from "../src/lib/workbench"

// Bun exposes `self` in its main thread; ELK otherwise mistakes it for a worker (as in workflow-layout.test).
beforeAll(async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self")
  Reflect.deleteProperty(globalThis, "self")
  try { const { default: ELK } = await import("elkjs/lib/elk.bundled.js"); new ELK() }
  finally { if (descriptor) Object.defineProperty(globalThis, "self", descriptor) }
})
const param = (name: string, type: string): Param =>
  ({ name, type, default: type === "r" ? 1 : "", choices: [], prompt: "", min: "", max: "" })
const phot: Spec = {
  name: "noao.digiphot.daophot.phot", title: "phot", package: "daophot", adapter: "generic",
  parameters: [param("verify", "b")],
  parameterSets: [{ name: "datapars", task: "daophot.datapars", parameters: [param("fwhmpsf", "r")] }],
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
const node = (name: string, run: Spec["run"], pkg = "giraf"): Spec => ({
  name, title: name, package: pkg, adapter: "generic", run, parameters: [], inputs: [], outputs: [], output: null, kind: "any",
})
const value = node("giraf.value", "value-constant")
const compute = node("giraf.compute", "value-compute")
const fileInput = node("giraf.file_input", "pass-files")
const fileSave = node("giraf.file_save", "save-files")
const catalog: Catalog = {
  version: "test",
  tasks: [phot, daoedit, value, compute, node("giraf.pset", "pset"), fileInput, fileSave, node("giraf.foreach", "foreach")],
  ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {},
}
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const make = (spec: Spec, id: string, patch: Partial<Instance> = {}) => ({ ...makeInstance(spec, catalog, prefs, id), ...patch })
const rows = (spec: Spec, valueRows: { name: string; value: string }[]) =>
  ({ draft: { ...make(spec, "x").draft, valueRows } })

/** daoedit → 계산 → phot, and a constant straight into 계산. */
function chain(view: Partial<TaskMap["view"]> = {}): TaskMap {
  let map = emptyMap()
  map = addTask(map, make(daoedit, "edit", { position: { x: 0, y: 0 } }))
  map = addTask(map, make(compute, "calc", { position: { x: 300, y: 40 }, ...rows(compute, [{ name: "m", value: "fwhm * k" }]) }))
  map = addTask(map, make(value, "k", { position: { x: 0, y: 300 }, ...rows(value, [{ name: "k", value: "4" }]) }))
  map = addTask(map, make(phot, "phot", { position: { x: 600, y: 0 } }))
  const link = (m: TaskMap, source: string, sourceHandle: string, target: string, targetHandle: string) =>
    connectFlow(m, catalog, [], { source, sourceHandle, target, targetHandle })
  map = link(map, "edit", "value:fwhm", "calc", "p:fwhm")
  map = link(map, "k", "value:k", "calc", "p:k")
  map = link(map, "calc", "value:m", "phot", "p:datapars.fwhmpsf")
  return { ...map, view: { ...map.view, selected: "", ...view } }
}

const edge = (source: string, target: string, sourceHandle = "out", targetHandle = "in"): Edge =>
  ({ id: `${source}>${target}`, source, target, sourceHandle, targetHandle })

test("helper kinds come from the schema run of GIRAF's own nodes only", () => {
  expect(helperKind(fileInput)).toBe("files")
  expect(helperKind(fileSave)).toBe("files")
  expect(helperKind(value)).toBe("values")
  expect(helperKind(compute)).toBe("values")
  expect(helperKind(catalog.tasks[4])).toBe("values")
  expect(helperKind(catalog.tasks[7])).toBeUndefined()
  expect(helperKind(phot)).toBeUndefined()
  // A run outside the giraf package is not a helper.
  expect(helperKind(node("user.value", "value-constant", "user"))).toBeUndefined()
})

test("only the kinds set to hide nodes are hidden", () => {
  let map = chain()
  map = addTask(map, make(fileInput, "files"))
  expect(hiddenHelpers(map, catalog).size).toBe(0)
  expect(hiddenHelpers({ ...map, view: { ...map.view, valueNodes: "edges" } }, catalog).size).toBe(0)
  expect([...hiddenHelpers({ ...map, view: { ...map.view, valueNodes: "nodes" } }, catalog)].sort()).toEqual(["calc", "k"])
  expect([...hiddenHelpers({ ...map, view: { ...map.view, fileNodes: "nodes" } }, catalog)]).toEqual(["files"])
})

test("a hidden value node between tasks leaves one bypass edge on the real rows", () => {
  const map = chain({ valueNodes: "nodes" })
  const edges = taskEdges(map, catalog)
  const bypass = bypassEdges(edges, hiddenHelpers(map, catalog))
  // The constant has nothing shown upstream: its value is on the row already.
  expect(bypass).toHaveLength(1)
  expect(bypass[0]).toMatchObject({
    source: "edit", target: "phot", sourceHandle: "value:fwhm", targetHandle: "p:datapars.fwhmpsf",
    selectable: false, deletable: false, focusable: false, className: "workflow-edge-value",
  })
  expect(bypass[0].data).toMatchObject({ bypass: true, value: true, connection: edges.find((e) => e.source === "calc")!.id })
})

test("chains through several hidden nodes collapse to one edge per shown pair", () => {
  const hidden = new Set(["h1", "h2", "h3"])
  const edges = [
    edge("a", "h1", "value:x"), edge("h1", "h2"), edge("h2", "b", "out", "p:y"),
    // A second route between the same pair does not draw a second edge.
    edge("a", "h3"), edge("h3", "h2"),
    edge("h2", "c", "out", "p:z"),
    // Shown ends are left alone; hidden edges are ignored.
    edge("a", "b"), { ...edge("d", "h1"), hidden: true },
  ]
  const bypass = bypassEdges(edges, hidden)
  expect(bypass.map((e) => [e.source, e.target, e.sourceHandle, e.targetHandle])).toEqual([
    ["a", "b", "value:x", "p:y"],
    ["a", "c", "value:x", "p:z"],
  ])
  // A cycle through hidden nodes ends.
  expect(bypassEdges([edge("h1", "h2"), edge("h2", "h1"), edge("h2", "b")], hidden)).toEqual([])
})

test("selection shows its hidden sources back to the first shown node", () => {
  const hidden = new Set(["h1", "h2", "h3", "save"])
  const edges = [edge("a", "h1"), edge("h1", "h2"), edge("h2", "b"), edge("h3", "c"), edge("b", "save")]
  expect([...peekedHelpers(edges, hidden, "b")].sort()).toEqual(["h1", "h2"])
  // A selected hidden node shows itself and what it reads from.
  expect([...peekedHelpers(edges, hidden, "h2")].sort()).toEqual(["h1", "h2"])
  expect([...peekedHelpers(edges, hidden, "save")]).toEqual(["save"])
  expect(peekedHelpers(edges, hidden, "").size).toBe(0)
  expect(peekedHelpers(edges, new Set(), "b").size).toBe(0)
})

test("a hidden node follows the node it feeds, else the one it reads from", () => {
  const hidden = new Set(["h1", "h2", "save", "alone"])
  const anchors = helperAnchors([edge("a", "h1"), edge("h1", "h2"), edge("h2", "b"), edge("b", "save")], hidden)
  expect(Object.fromEntries(anchors)).toEqual({ h1: "b", h2: "b", save: "b" })
})

test("auto layout leaves hidden nodes out and moves them with the node they feed", async () => {
  const map = chain({ valueNodes: "nodes" })
  const laid = await autoLayoutMap(map, catalog)
  const at = (m: TaskMap, id: string) => m.tasks.find((t) => t.id === id)!.position!
  const shift = { x: at(laid, "phot").x - at(map, "phot").x, y: at(laid, "phot").y - at(map, "phot").y }
  expect(at(laid, "calc")).toEqual({ x: 300 + shift.x, y: 40 + shift.y })
  expect(at(laid, "k")).toEqual({ x: 0 + shift.x, y: 300 + shift.y })
  // The bypass edge orders daoedit before phot.
  expect(at(laid, "edit").x).toBeLessThan(at(laid, "phot").x)
  expect(Object.keys(laid.edgeRoutes ?? {}).some((id) => id.startsWith("bypass:"))).toBe(false)
})

test("the old hidden-edge switches load as the edges level", () => {
  const view = { ...emptyMap().view, hideFileEdges: true, hideValueEdges: false }
  expect(migrateHelperView(view)).toEqual({ ...emptyMap().view, fileNodes: "edges" })
  expect(migrateHelperView({ ...view, fileNodes: "nodes" }).fileNodes).toBe("nodes")
  const saved = { ...chain(), view: { ...chain().view, hideValueEdges: true } }
  const loaded = migrateMap({ ...prefs, taskMap: saved as TaskMap }, catalog)
  expect(loaded.view.valueNodes).toBe("edges")
  expect("hideValueEdges" in loaded.view).toBe(false)
})
