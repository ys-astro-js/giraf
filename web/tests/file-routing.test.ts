import { test, expect } from "bun:test"
import type { Catalog, Frame, Preferences, Spec } from "../src/lib/workbench"
import { connect, emptyMap, makeInstance, payloadFor } from "../src/lib/task-map"
import { assigned } from "../src/lib/task-map/inputs"
import { filesLabel, isSourceNode, normalizeFileInputs } from "../src/lib/file-nodes"

const kinds: [string, string][] = [["image", "image"], ["text", "text"], ["list", "image-list"]]
const source: Spec = {
  name: "giraf.file_input", taskName: "파일 입력", title: "파일 입력", package: "giraf", icon: "file-input",
  adapter: "generic", run: "pass-files", runnable: true, parameters: [], output: null, kind: "any",
  inputs: [{ name: "files", label: "파일", kind: "any", multiple: true, required: true, sources: ["files"] }],
  outputs: kinds.map(([name, kind]) => ({ name, kind, mode: "pass", from: "files", optional: true, default: "" })),
}
const combine: Spec = {
  name: "imcombine", title: "imcombine", package: "images", adapter: "generic", parameters: [], output: null, kind: "image",
  inputs: [{ name: "input", label: "input", kind: "image", multiple: true, required: true }],
  outputs: [{ name: "output", kind: "image", default: "out.fits" }],
}
const catalog: Catalog = { version: "test", tasks: [source, combine], ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {} }
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const rows: Frame[] = ["bias001.fits", "bias002.fits", "bias003.fits"].map((label, i) => ({ id: "b" + i, label, asset: "image" }))
const ids = rows.map((r) => r.id)

function withTasks(...names: string[]) {
  return { ...emptyMap(), tasks: names.map((id) => ({ ...makeInstance(combine, catalog, prefs, id), position: { x: 400, y: 100 } })) }
}

test("only a files-in, pass-out node counts as a file source", () => {
  expect(isSourceNode(source)).toBe(true)
  expect(isSourceNode(combine)).toBe(false)
  expect(filesLabel(ids, rows, "input")).toBe("bias")
  expect(filesLabel(["b0"], rows, "input")).toBe("bias001")
})

test("files on a task input move into a collapsed file node left of it", () => {
  let map = connect(withTasks("a"), "a", "input", { kind: "files", ids, label: "선택한 자료" }, false)
  map = normalizeFileInputs(map, catalog, rows)
  expect(map.version).toBe(2)
  const node = map.tasks.find((t) => t.task === source.name)!
  expect(node).toMatchObject({ label: "bias", collapsed: true, position: { x: 400 - 184 - 80, y: 100 } })
  expect(map.connections.find((c) => c.target === node.id)?.source).toEqual({ kind: "files", ids, label: "bias" })
  expect(map.connections.find((c) => c.target === "a")?.source).toEqual({ kind: "pending", taskId: node.id, outputRole: "image" })
  // The files are usable without running the file node.
  expect(node.passed).toEqual({ image: ids, text: [], list: [] })
  expect(assigned(map, map.tasks[0], "input").ids).toEqual(ids)
  expect(payloadFor(map, "a", catalog).inputs.input).toEqual(ids)
  expect(normalizeFileInputs(map, catalog, rows)).toBe(map)
})

test("the same files on two tasks share one file node; legacy draft ids migrate too", () => {
  let map = withTasks("a", "b")
  map.tasks[1].draft.inputs.input = [...ids]
  map = connect(map, "a", "input", { kind: "files", ids: [...ids].reverse(), label: "자료" }, false)
  map = normalizeFileInputs(map, catalog, rows)
  const nodes = map.tasks.filter((t) => t.task === source.name)
  expect(nodes).toHaveLength(1)
  expect(map.tasks.find((t) => t.id === "b")!.draft.inputs.input).toEqual([])
  expect(map.connections.filter((c) => c.source.kind === "pending" && c.source.taskId === nodes[0].id).map((c) => c.target).sort()).toEqual(["a", "b"])
})
