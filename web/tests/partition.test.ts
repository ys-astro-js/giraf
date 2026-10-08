import { test, expect } from "bun:test"
import type { Catalog, Frame, Preferences, Spec } from "../src/lib/workbench"
import { connect, emptyMap, makeInstance, type TaskMap } from "../src/lib/task-map"
import { resolvedSource } from "../src/lib/task-map/runs"
import { nodeGeometry } from "../src/lib/node-interaction"
import { memberHandle, partitionValues, syncPassOutputs, updateOutputPort } from "../src/lib/output-ports"
import { connectFlow, flowEdges, outputHandle } from "../src/lib/workflow-flow"

const source: Spec = {
  name: "giraf.file_input", taskName: "파일 입력", title: "파일 입력", package: "giraf", adapter: "generic",
  run: "pass-files", runnable: true, parameters: [], output: null, kind: "any",
  inputs: [{ name: "files", label: "파일", kind: "any", multiple: true, required: true, sources: ["files"] }],
  outputs: [{ name: "image", kind: "image", mode: "pass", from: "files", optional: true, default: "" }],
}
const combine: Spec = {
  name: "combine", title: "combine", package: "test", adapter: "generic", runnable: true, parameters: [], output: null,
  kind: "image", inputs: [{ name: "input", label: "input", kind: "image", multiple: true, required: true }],
  outputs: [{ name: "output", kind: "image", default: "c_" }],
}
const catalog: Catalog = { version: "test", tasks: [source, combine], ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {} }
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const frame = (id: string, filter?: string): Frame =>
  ({ id, label: id + ".fits", asset: "image", headers: filter === undefined ? {} : { FILTER: filter, EXPTIME: "30" } })
const rows = [frame("b1", "B"), frame("v1", " V "), frame("b2", "B"), frame("n")]

function filesByFilter(): TaskMap {
  const a = makeInstance(source, catalog, prefs, "a"), c = makeInstance(combine, catalog, prefs, "c")
  a.outputPorts = [{ id: "$default", name: "", files: ["*"], outputRole: "image", partition: { keyword: "FILTER" } }]
  const map = connect({ ...emptyMap(), tasks: [a, c] }, "a", "files", { kind: "files", ids: rows.map((r) => r.id), label: "파일" })
  return syncPassOutputs(map, catalog, rows)
}

test("partition values are sorted distinct header values, missing keywords sharing an empty value", () => {
  expect(partitionValues(rows.map((r) => r.id), rows, "FILTER")).toEqual(["", "B", "V"])
  expect(partitionValues(["b1", "v1"], rows, "EXPTIME")).toEqual(["30"])
})

test("a partitioned pass output carries each member's files", () => {
  const passed = filesByFilter().tasks[0].passed!
  expect(passed.image).toEqual(["b1", "v1", "b2", "n"])
  expect(passed["image~B"]).toEqual(["b1", "b2"])
  expect(passed["image~V"]).toEqual(["v1"])
  expect(passed["image~"]).toEqual(["n"])
})

test("a member handle connects one value; its edge returns to that handle", () => {
  let map = filesByFilter()
  map = connectFlow(map, catalog, rows, { source: "a", sourceHandle: memberHandle("output", "B"), target: "c", targetHandle: "input" })
  const link = map.connections.find((c) => c.target === "c")!
  expect(link.source.partition).toEqual({ keyword: "FILTER", value: "B" })
  expect(resolvedSource(map, link.source)).toMatchObject({ kind: "result", ids: ["b1", "b2"] })
  expect(outputHandle(link.source, source, map.tasks[0])).toBe("output~B")
  expect(flowEdges(map, catalog).find((e) => e.target === "c")?.sourceHandle).toBe("output~B")
  // The bundle itself still passes every file.
  const bundle = connectFlow(map, catalog, rows, { source: "a", sourceHandle: "output", target: "c", targetHandle: "input" })
  const all = bundle.connections.filter((c) => c.target === "c").find((c) => !c.source.partition)!
  expect(resolvedSource(bundle, all.source)).toMatchObject({ ids: ["b1", "v1", "b2", "n"] })
  // Removing the partition drops the member links.
  const cleared = updateOutputPort(map, "a", { id: "$default", name: "", files: ["*"], outputRole: "image" }, catalog)
  expect(cleared.connections.some((c) => c.target === "c")).toBe(false)
})

test("a pending member resolves to the run products with that header value", () => {
  const map = filesByFilter()
  map.runs = [{ id: "r", instanceId: "c", state: "completed", products: [
    { ...frame("cb", "B"), role: "output" }, { ...frame("cv", "V"), role: "output" }] }]
  const pending = { kind: "pending" as const, taskId: "c", outputRole: "output", partition: { keyword: "FILTER", value: "V" } }
  expect(resolvedSource(map, pending)).toMatchObject({ kind: "result", runId: "r", ids: ["cv"] })
  expect(outputHandle(pending, combine, map.tasks[1])).toBe("output~V")
})

test("an open bundle lists a member row per value", () => {
  const map = filesByFilter()
  const closed = nodeGeometry(map, map.tasks[0], catalog, rows)
  expect(closed.bundles.output).toEqual({ keyword: "FILTER", values: ["", "B", "V"], open: false })
  expect(new Set(closed.members.map((m) => m.y))).toEqual(new Set([closed.outputY]))
  map.tasks[0].outputPorts![0].open = true
  const open = nodeGeometry(map, map.tasks[0], catalog, rows)
  expect(open.height - closed.height).toBe(3 * 28)
  expect(open.members.map((m) => [m.handleId, m.y])).toEqual([
    ["output~", closed.outputY + 30], ["output~B", closed.outputY + 58], ["output~V", closed.outputY + 86]])
})
