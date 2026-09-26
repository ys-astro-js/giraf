import { expect, test } from "bun:test"
import { createEditorStore } from "../src/lib/edit-history"
import { emptyMap, removeTask, type TaskMap } from "../src/lib/task-map"
import { makeDraft, type Catalog } from "../src/lib/workbench"

const rename =
  (name: string) =>
  (map: TaskMap): TaskMap => ({
    ...map,
    subflows: [
      { id: "group", name, position: { x: 0, y: 0 }, width: 300, height: 200 },
    ],
  })
const fixture = () => {
  const map = emptyMap()
  map.tasks = ["a", "b"].map((id) => ({
    id,
    task: "imcopy",
    label: id,
    draft: makeDraft(),
    preprocess: makeDraft(),
    mapping: {},
    instrument: [],
    packageValues: {},
    backend: "cl",
    expressions: {},
    filePolicy: { mode: "copy", backup: true },
  }))
  map.connections = [
    {
      id: "link",
      target: "b",
      role: "input",
      source: { kind: "pending", taskId: "a" },
    },
  ]
  map.view.selected = "a"
  return map
}

test("zundo jumps multiple edits with ordered menu labels and preserves live runs and viewport", () => {
  const editor = createEditorStore(emptyMap())
  for (const name of ["one", "two", "three"]) editor.update(rename(name), name)
  const snapshots = editor.store.temporal.getState().pastStates
  editor.publishRun("a", { id: "run", state: "completed", products: [] })
  expect(editor.store.temporal.getState().pastStates).toBe(snapshots)
  expect(
    snapshots.every(
      (snapshot) => !("runs" in snapshot) && !("view" in snapshot)
    )
  ).toBe(true)
  editor.update((map) => ({ ...map, view: { ...map.view, zoom: 2 } }))
  expect(editor.history().past.map((entry) => entry.label)).toEqual([
    "one",
    "two",
    "three",
  ])
  editor.undo(2)
  expect(editor.getMap().subflows?.[0].name).toBe("one")
  expect(editor.getMap().runs[0].state).toBe("completed")
  expect(editor.getMap().view.zoom).toBe(2)
  expect(editor.history().future.map((entry) => entry.label)).toEqual([
    "three",
    "two",
  ])
  editor.redo(2)
  expect(editor.getMap().subflows?.[0].name).toBe("three")
})

test("one gesture creates one checkpoint, no-op and selection preserve redo, new edit branches", () => {
  const editor = createEditorStore(emptyMap())
  editor.beginEdit()
  for (const name of ["a", "ab", "abc"])
    editor.update(rename(name), "이름 변경")
  editor.endEdit()
  expect(editor.history().past).toHaveLength(1)
  editor.undo()
  expect(editor.getMap().subflows).toBeUndefined()
  const before = editor.getMap()
  expect(editor.update((map) => map)).toBe(false)
  expect(editor.getMap()).toBe(before)
  editor.update((map) => ({ ...map, view: { ...map.view, selected: "b" } }))
  editor.update((map) => ({
    ...map,
    tasks: [...map.tasks],
    subflows: map.subflows?.map((group) => ({ ...group })),
  }))
  expect(editor.history().past).toHaveLength(0)
  expect(editor.history().future).toHaveLength(1)
  editor.update(rename("branch"), "새 이름")
  expect(editor.history().future).toHaveLength(0)
})

test("reset isolates documents and bounded history evicts only oldest edits", () => {
  const editor = createEditorStore(emptyMap(), { historyLimit: 3 })
  for (const name of ["1", "2", "3", "4", "5"])
    editor.update(rename(name), name)
  expect(editor.history().past).toHaveLength(3)
  editor.undo(3)
  expect(editor.getMap().subflows?.[0].name).toBe("2")
  editor.reset(emptyMap())
  expect(editor.history()).toEqual({ past: [], future: [] })
  expect(editor.undo()).toBe(false)
  expect(editor.redo()).toBe(false)
})

test("deletion undo restores nodes, links and selection, redo deletes again", () => {
  const map = fixture()
  const editor = createEditorStore(map)
  editor.update((current) => removeTask(current, "a"), "a 삭제")
  editor.undo()
  expect(editor.getMap().tasks).toEqual(map.tasks)
  expect(editor.getMap().connections).toEqual(map.connections)
  expect(editor.getMap().view.selected).toBe("a")
  editor.redo()
  expect(editor.getMap().tasks.map((task) => task.id)).toEqual(["b"])
  expect(editor.getMap().connections).toEqual([])
})

test("workflow bindings stay current across undo without rewriting history or repinning edited links", () => {
  const catalog = {
    tasks: [
      {
        name: "imcopy",
        adapter: "generic",
        inputs: [{ name: "input", kind: "image", multiple: true }],
      },
    ],
  } as Catalog
  const editor = createEditorStore(fixture())
  editor.update(rename("one"), "그룹 추가")
  const history = editor.store.temporal.getState().pastStates
  editor.publishRun(
    "a",
    {
      id: "run",
      state: "completed",
      products: [{ id: "output", label: "out.fits", asset: "image" }],
    },
    catalog
  )
  expect(editor.getMap().connections[0].source).toMatchObject({
    kind: "result",
    runId: "run",
    ids: ["output"],
  })
  expect(editor.store.temporal.getState().pastStates).toBe(history)
  editor.update(rename("two"), "그룹 변경")
  editor.undo(2)
  expect(editor.getMap().connections[0].source).toMatchObject({
    kind: "result",
    runId: "run",
  })
  editor.update(
    (map) => ({
      ...map,
      connections: [
        {
          ...map.connections[0],
          source: { kind: "files", ids: ["manual"], label: "선택한 파일" },
        },
      ],
    }),
    "입력 변경"
  )
  expect(editor.getMap().connections[0].source).toMatchObject({
    kind: "files",
    ids: ["manual"],
  })
  editor.undo()
  expect(editor.getMap().connections[0].source).toMatchObject({
    kind: "result",
    runId: "run",
  })
  editor.update(
    (map) => ({
      ...map,
      connections: [
        {
          ...map.connections[0],
          source: {
            kind: "result",
            taskId: "a",
            runId: "older",
            ids: ["pinned"],
          },
        },
      ],
    }),
    "이전 결과 선택"
  )
  expect(editor.getMap().connections[0].source).toMatchObject({
    runId: "older",
    ids: ["pinned"],
  })
  const next = {
    id: "next",
    state: "completed",
    products: [{ id: "new", label: "new.fits", asset: "image" }],
  }
  expect(editor.publishRun("a", next, catalog)).toBe(true)
  expect(editor.publishRun("a", next, catalog)).toBe(false)
  expect(editor.getMap().connections[0].source).toMatchObject({
    runId: "next",
    ids: ["new"],
  })
})

test("deleted library assets never return through undo or redo and updates do not scan history", () => {
  const map = fixture()
  map.connections = [
    {
      id: "file",
      target: "b",
      role: "input",
      source: { kind: "files", ids: ["gone", "keep"], label: "파일" },
    },
  ]
  const editor = createEditorStore(map)
  editor.update(rename("one"), "그룹 추가")
  const history = editor.store.temporal.getState().pastStates
  editor.removeLibrary(new Set(["gone"]), new Set())
  expect(editor.store.temporal.getState().pastStates).toBe(history)
  editor.undo()
  expect(editor.getMap().connections[0].source).toMatchObject({ ids: ["keep"] })
  editor.redo()
  expect(editor.getMap().connections[0].source).toMatchObject({ ids: ["keep"] })
})
