import { expect, test } from "bun:test"
import {
  copyTasks,
  duplicateTask,
  emptyMap,
  pasteTasks,
  removeTask,
  type Instance,
  type TaskMap,
} from "../src/lib/task-map"
import { makeDraft } from "../src/lib/workbench"
import { matchesShortcut, shortcutKeys, shortcuts } from "../src/lib/shortcuts"

const node = (id: string, x: number, extra: Partial<Instance> = {}): Instance => ({
  id,
  task: "imcopy",
  label: id,
  draft: makeDraft(undefined, { parameters: { verbose: true } }),
  preprocess: makeDraft(),
  mapping: {},
  instrument: [],
  packageValues: {},
  position: { x, y: 100 },
  ...extra,
})

const fixture = (): TaskMap => ({
  ...emptyMap(),
  tasks: [node("a", 100), node("b", 400), node("c", 700)],
  connections: [
    { id: "in", target: "a", role: "input", source: { kind: "files", ids: ["file"], label: "파일" } },
    { id: "ab", target: "b", role: "input", source: { kind: "pending", taskId: "a" } },
    { id: "bc", target: "c", role: "input", source: { kind: "result", taskId: "b", runId: "run", ids: ["out"] } },
  ],
  view: { ...emptyMap().view, selected: "a" },
})
const at = () => undefined

test("pasting one node matches duplicating it", () => {
  const map = fixture()
  const pasted = pasteTasks(map, copyTasks(map, ["b"], at)!, [])
  const duplicated = duplicateTask(map, "b", { x: 448, y: 148 })
  const strip = (m: TaskMap) => ({
    ...m,
    tasks: m.tasks.map((t) => ({ ...t, id: t.id.length > 2 ? "copy" : t.id })),
    connections: m.connections.map((c) => ({
      ...c,
      id: c.id.length > 2 ? "link" : c.id,
      target: c.target.length > 2 ? "copy" : c.target,
    })),
    view: { ...m.view, selected: "copy" },
  })
  expect(strip(pasted)).toEqual(strip(duplicated))
  expect(pasted.view.selected).toBe(pasted.tasks[3].id)
})

test("several nodes keep the links among them and wait for their own runs", () => {
  const map = fixture()
  const next = pasteTasks(map, copyTasks(map, ["b", "c"], at)!, [])
  const [b, c] = next.tasks.slice(3)
  expect([b.label, c.label]).toEqual(["b", "c"])
  expect(b.position).toEqual({ x: 448, y: 148 })
  expect(c.position).toEqual({ x: 748, y: 148 })
  const links = next.connections.slice(3)
  // a → b's copy keeps its outside source; b → c is now between the copies.
  expect(links.map((l) => [l.target, l.source])).toEqual([
    [b.id, { kind: "pending", taskId: "a" }],
    [c.id, { kind: "pending", taskId: b.id }],
  ])
  expect(next.view.selected).toBe(b.id)
})

test("pastes again without stacking, and after the originals are gone", () => {
  let map = fixture()
  const clip = copyTasks(map, ["b", "c"], at)!
  const occupied = (m: TaskMap) => m.tasks.map((t) => t.position!)
  map = pasteTasks(map, clip, occupied(map))
  map = pasteTasks(map, clip, occupied(map))
  expect(map.tasks.slice(3).map((t) => t.position)).toEqual([
    { x: 448, y: 148 },
    { x: 748, y: 148 },
    { x: 496, y: 196 },
    { x: 796, y: 196 },
  ])
  expect(new Set(map.tasks.map((t) => t.id)).size).toBe(7)

  let gone = removeTask(removeTask(fixture(), "a"), "b")
  gone = pasteTasks(gone, clip, occupied(gone))
  const [b, c] = gone.tasks.slice(1)
  // Nothing feeds b's copy any more; c's copy still takes b's copy.
  expect(gone.connections.filter((l) => l.target === b.id)).toEqual([])
  expect(gone.connections.find((l) => l.target === c.id)?.source).toEqual({ kind: "pending", taskId: b.id })
})

test("a copied result from a node that is gone stays as its files", () => {
  const map = fixture()
  const clip = copyTasks(map, ["c"], at)!
  const next = pasteTasks(removeTask(map, "b"), clip, [])
  expect(next.connections.at(-1)?.source).toEqual({ kind: "result", runId: "run", ids: ["out"] })
})

test("the clip is a snapshot", () => {
  const map = fixture()
  const clip = copyTasks(map, ["a"], at)!
  map.tasks[0].draft.parameters.verbose = false
  map.tasks[0].label = "renamed"
  const next = pasteTasks(map, clip, [])
  expect(next.tasks.at(-1)?.label).toBe("a")
  expect(next.tasks.at(-1)?.draft.parameters.verbose).toBe(true)
})

test("a node without a saved place is copied where it is drawn", () => {
  const map = fixture()
  delete map.tasks[0].position
  const next = pasteTasks(map, copyTasks(map, ["a"], () => ({ x: 40, y: 40 }))!, [])
  expect(next.tasks.at(-1)?.position).toEqual({ x: 88, y: 88 })
})

test("a grouped node pastes into its group while the group is there", () => {
  const map = fixture()
  map.subflows = [{ id: "g", name: "그룹", position: { x: 0, y: 0 }, width: 900, height: 400 }]
  map.tasks[1].subflowId = "g"
  const clip = copyTasks(map, ["b"], at)!
  expect(pasteTasks(map, clip, []).tasks.at(-1)?.subflowId).toBe("g")
  expect(pasteTasks({ ...map, subflows: [] }, clip, []).tasks.at(-1)?.subflowId).toBeUndefined()
})

test("a container comes with its group and members", () => {
  const map = fixture()
  map.subflows = [{ id: "a", name: "반복", position: { x: 80, y: 60 }, width: 300, height: 200 }]
  map.tasks[1].subflowId = "a"
  const clip = copyTasks(map, ["a", "b"], at)!
  expect(clip.roots).toEqual(["a"])
  const next = pasteTasks(map, clip, [])
  const [copy, member] = next.tasks.slice(3)
  expect(next.subflows?.at(-1)).toMatchObject({ id: copy.id, position: { x: 128, y: 108 } })
  expect(member.subflowId).toBe(copy.id)
})

test("nothing to copy gives no clip", () => {
  expect(copyTasks(fixture(), ["missing"], at)).toBeNull()
})

test("shortcuts match by physical key and show per platform", () => {
  const key = (code: string, key: string, mods: Partial<KeyboardEvent> = {}) => ({
    code, key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods,
  })
  // A Korean input source reports ㅊ for the C key.
  expect(matchesShortcut(key("KeyC", "ㅊ", { metaKey: true }), shortcuts.copy)).toBe(true)
  expect(matchesShortcut(key("KeyC", "c", { ctrlKey: true }), shortcuts.copy)).toBe(true)
  expect(matchesShortcut(key("KeyC", "c"), shortcuts.copy)).toBe(false)
  expect(matchesShortcut(key("Enter", "Enter", { metaKey: true, shiftKey: true }), shortcuts.runAll)).toBe(true)
  expect(matchesShortcut(key("Enter", "Enter", { metaKey: true, shiftKey: true }), shortcuts.runGroup)).toBe(false)
  expect(matchesShortcut(key("NumpadEnter", "Enter"), shortcuts.run)).toBe(true)
  expect(shortcutKeys(shortcuts.runAll, true)).toEqual(["⇧", "⌘", "↵"])
  expect(shortcutKeys(shortcuts.runAll, false)).toEqual(["Ctrl", "Shift", "Enter"])
  expect(shortcutKeys(shortcuts.addTask, true)).toEqual(["⌘", "N"])
})
