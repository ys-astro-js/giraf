import { test, expect } from "bun:test"
import type { Catalog, Frame, Preferences, Spec } from "../src/lib/workbench"
import { connect, emptyMap, makeInstance, payloadFor } from "../src/lib/task-map"
import { connectionChoices, nodeGeometry } from "../src/lib/node-interaction"
import { syncPassOutputs } from "../src/lib/output-ports"
import { workflowDocument } from "../src/lib/workflow-document"

const kinds: [string, string][] = [["image", "image"], ["text", "text"], ["list", "image-list"]]
const source: Spec = {
  name: "giraf.file_input", taskName: "파일 입력", title: "파일 입력", package: "giraf", icon: "file-input",
  adapter: "generic", run: "pass-files", runnable: true, parameters: [], output: null, kind: "any",
  inputs: [{ name: "files", label: "파일", kind: "any", multiple: true, required: true, sources: ["files"] }],
  outputs: kinds.map(([name, kind]) => ({ name, kind, mode: "pass", from: "files", optional: true, default: "" })),
}
const sink: Spec = {
  name: "giraf.file_save", taskName: "파일 저장", title: "파일 저장", package: "giraf", icon: "folder-down",
  adapter: "generic", run: "save-files", runnable: true, parameters: [], output: null,
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
  expect(payloadFor(map, "a", catalog).outputs).toMatchObject({ image: "*", text: "*", list: "" })
})

test("an input without the node source takes no node outputs; a save-files node carries its destination", () => {
  const a = makeInstance(source, catalog, prefs, "a"), b = makeInstance(sink, catalog, prefs, "b")
  b.draft.destination = { path: "/Volumes/USB/결과", conflict: "overwrite" }
  const map = { ...emptyMap(), tasks: [a, b] }
  expect(() => connectionChoices(map, catalog, { kind: "pending", taskId: "b" }, "a", [])).toThrow()
  expect(connectionChoices(map, catalog, { kind: "pending", taskId: "a", outputRole: "image" }, "b", []).map((s) => s.name)).toEqual(["files"])
  expect(payloadFor(map, "b", catalog).destination).toEqual({ path: "/Volumes/USB/결과", conflict: "overwrite" })
  const shared = workflowDocument(prefs, map).taskMap.tasks[1].draft.destination
  expect(shared).toEqual({ path: "", conflict: "overwrite" })
})
