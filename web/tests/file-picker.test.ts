import { expect, test } from "bun:test"
import {
  actionTargets,
  addInputs,
  clickHighlight,
  emptyHighlight,
  groupRuns,
  keepListed,
  moveHighlight,
  pathCrumbs,
  removeInputs,
  reorder,
  step,
  visit,
} from "../src/lib/file-picker"
import type { Frame, Job } from "../src/lib/workbench"

const order = ["a", "b", "c", "d", "e"]

test("a click highlights one row and ⇧click highlights the range from it", () => {
  const one = clickHighlight(emptyHighlight, order, "b")
  expect(one.selected).toEqual(["b"])
  const span = clickHighlight(one, order, "d", { shift: true })
  expect(span.selected).toEqual(["b", "c", "d"])
  // The anchor stays, so a second ⇧click re-spans from it.
  expect(clickHighlight(span, order, "a", { shift: true }).selected).toEqual([
    "a",
    "b",
  ])
})

test("⌘click toggles a row and ⌘⇧click adds a range", () => {
  let state = clickHighlight(emptyHighlight, order, "a")
  state = clickHighlight(state, order, "c", { toggle: true })
  expect(state.selected).toEqual(["a", "c"])
  state = clickHighlight(state, order, "e", { shift: true, toggle: true })
  expect(state.selected).toEqual(["a", "c", "d", "e"])
  state = clickHighlight(state, order, "a", { toggle: true })
  expect(state.selected).toEqual(["c", "d", "e"])
})

test("arrow keys move the highlight and ⇧ arrows grow it", () => {
  let state = moveHighlight(emptyHighlight, order, 1)
  expect(state.selected).toEqual(["a"])
  state = moveHighlight(state, order, 1, true)
  state = moveHighlight(state, order, 1, true)
  expect(state.selected).toEqual(["a", "b", "c"])
  state = moveHighlight(state, order, 1)
  expect(state).toEqual({ selected: ["d"], anchor: "d", focus: "d" })
  expect(moveHighlight(state, order, 9).focus).toBe("e")
  expect(moveHighlight(emptyHighlight, order, -1).focus).toBe("e")
})

test("a row action covers every highlighted row only when the row is highlighted", () => {
  const state = { selected: ["d", "b"], anchor: "b", focus: "d" }
  expect(actionTargets(state, order, "b")).toEqual(["b", "d"])
  expect(actionTargets(state, order, "c")).toEqual(["c"])
})

test("rows that leave the list leave the highlight", () => {
  const state = { selected: ["a", "z"], anchor: "z", focus: "a" }
  expect(keepListed(state, order)).toEqual({
    selected: ["a"],
    anchor: null,
    focus: "a",
  })
})

test("inputs keep their order, take each file once, and a single input keeps one", () => {
  expect(addInputs(["x"], ["a", "x", "b"], true)).toEqual(["x", "a", "b"])
  expect(addInputs(["x"], ["a", "b"], false)).toEqual(["a"])
  expect(removeInputs(["a", "b", "c"], ["b"])).toEqual(["a", "c"])
})

test("chosen inputs move up and down as a block and stop at the ends", () => {
  expect(reorder(order, ["c", "d"], -1)).toEqual(["a", "c", "d", "b", "e"])
  expect(reorder(order, ["a", "c"], -1)).toEqual(["a", "c", "b", "d", "e"])
  expect(reorder(order, ["d", "e"], 1)).toEqual(order)
  expect(reorder(order, ["b"], 1)).toEqual(["a", "c", "b", "d", "e"])
})

test("back and forward walk the visited places; a new place drops forward", () => {
  let history = { entries: ["/a"], index: 0 }
  history = visit(history, "/a/b")
  history = visit(history, "/a/b/c")
  history = step(step(history, -1), -1)
  expect(history.entries[history.index]).toBe("/a")
  expect(step(history, -1)).toBe(history)
  history = visit(step(history, 1), "/x")
  expect(history.entries).toEqual(["/a", "/a/b", "/x"])
  expect(step(history, 1)).toBe(history)
})

test("a path splits into crumbs from the root", () => {
  expect(pathCrumbs("/Users/js")).toEqual([
    { name: "/", path: "/" },
    { name: "Users", path: "/Users" },
    { name: "js", path: "/Users/js" },
  ])
})

test("run results group by run, newest first, with a node's earlier runs folded", () => {
  const file = (id: string, asset = "image"): Frame => ({ id, label: id, asset })
  const job = (
    id: string,
    createdAt: number,
    node: string,
    products: Frame[],
    execution?: string
  ): Job => ({
    id,
    name: "imcombine",
    task: "imcombine",
    createdAt,
    state: "completed",
    message: "",
    count: products.length,
    progress: 1,
    products,
    execution: null,
    manifest: {
      instanceId: node,
      nodeLabel: node,
      workflowId: execution,
    } as Job["manifest"],
  })
  const jobs = [
    job("20261001-100000-a", 1, "dark", [file("d1")]),
    job("20261001-110000-b", 2, "flat", [file("f1")]),
    job("20261001-120000-c", 3, "dark", [file("d2")], "run"),
    job("20261001-120001-d", 4, "dark", [file("d3")], "run"),
    job("20261001-130000-e", 5, "log", [file("t", "text")]),
  ]
  const { recent, older } = groupRuns(jobs, (f) => f.asset === "image")
  expect(recent.map((group) => group.id)).toEqual([
    "20261001-120001-d",
    "20261001-120000-c",
    "20261001-110000-b",
  ])
  expect(recent[0]).toMatchObject({ title: "dark", task: "imcombine", time: "10/01 12:00:01" })
  expect(older.map((group) => group.id)).toEqual(["20261001-100000-a"])
})
