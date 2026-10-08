import { test, expect } from "bun:test"
import type { Catalog, Frame, Preferences, Spec } from "../src/lib/workbench"
import { connect, emptyMap, makeInstance, payloadFor } from "../src/lib/task-map"
import { connectionChoices, nodeGeometry } from "../src/lib/node-interaction"
import { syncPassOutputs } from "../src/lib/output-ports"
import { workflowDocument } from "../src/lib/workflow-document"

const kinds = ["image", "text", "image-list", "mask", "metacode", "binary"]
const source: Spec = {
  name: "workflow.file_input", taskName: "파일 입력", title: "파일 입력", package: "workflow",
  adapter: "generic", executor: "file-input", runnable: true, parameters: [], output: null, kind: "any",
  inputs: [{ name: "files", label: "파일", kind: "any", multiple: true, required: true, connectable: false }],
  outputs: kinds.map((kind) => ({ name: kind, kind, mode: "pass", source: "files", optional: true, default: "" })),
}
const sink: Spec = {
  name: "workflow.file_save", taskName: "파일 저장", title: "파일 저장", package: "workflow",
  adapter: "generic", executor: "file-save", destination: true, runnable: true, parameters: [], output: null,
  kind: "any", inputs: [{ name: "files", label: "파일", kind: "any", multiple: true, required: true }], outputs: [],
}
const catalog: Catalog = { version: "test", tasks: [source, sink], ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {} }
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const rows: Frame[] = [
  { id: "a", label: "a.fits", asset: "image" },
  { id: "t", label: "stars.txt", asset: "text" },
]

test("a file source shows one port per kind it carries, the first as its main output", () => {
  const a = makeInstance(source, catalog, prefs, "a")
  let map = connect({ ...emptyMap(), tasks: [a] }, "a", "files", { kind: "files", ids: ["t"], label: "파일" })
  map = syncPassOutputs(map, catalog, rows)
  let geometry = nodeGeometry(map, map.tasks[0], catalog, rows)
  expect(geometry.primaryOutputRole).toBe("text")
  expect(geometry.outputs.map((o) => o.name)).toEqual([])
  map = syncPassOutputs(connect(map, "a", "files", { kind: "files", ids: ["a", "t"], label: "파일" }, false), catalog, rows)
  geometry = nodeGeometry(map, map.tasks[0], catalog, rows)
  expect(geometry.primaryOutputRole).toBe("image")
  expect(geometry.outputs.map((o) => o.name)).toEqual(["text"])
  expect(syncPassOutputs(map, catalog, rows)).toBe(map)
  expect(payloadFor(map, "a", catalog).outputs).toMatchObject({ image: "*", text: "*", mask: "" })
})

test("a file source takes no node outputs, and a file sink carries its destination", () => {
  const a = makeInstance(source, catalog, prefs, "a"), b = makeInstance(sink, catalog, prefs, "b")
  b.draft.destination = { path: "/Volumes/USB/결과", conflict: "overwrite" }
  const map = { ...emptyMap(), tasks: [a, b] }
  expect(() => connectionChoices(map, catalog, { kind: "pending", taskId: "b" }, "a", [])).toThrow()
  expect(connectionChoices(map, catalog, { kind: "pending", taskId: "a", outputRole: "image" }, "b", []).map((s) => s.name)).toEqual(["files"])
  expect(payloadFor(map, "b", catalog).destination).toEqual({ path: "/Volumes/USB/결과", conflict: "overwrite" })
  const shared = workflowDocument(prefs, map).taskMap.tasks[1].draft.destination
  expect(shared).toEqual({ path: "", conflict: "overwrite" })
})
