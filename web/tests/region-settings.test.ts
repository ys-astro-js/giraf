import { expect, test } from "bun:test"
import { withMeans } from "../src/lib/korean"
import { evaluateExpression, expressionText } from "../src/lib/flow-expression"
import { borderCrossing, chipPlace, pathPoints } from "../src/lib/edge-crossing"
import { flowKeywordChoices } from "../src/lib/containers"
import { addTask, emptyMap, makeInstance, type TaskMap } from "../src/lib/task-map"
import type { Catalog, Frame, Spec } from "../src/lib/workbench"

test("로 and 으로 follow how the word ends", () => {
  expect(withMeans("EXPTIME")).toBe("EXPTIME로")
  expect(withMeans("FILTER, EXPTIME")).toBe("FILTER, EXPTIME로")
  expect(withMeans("묶음")).toBe("묶음으로")
  expect(withMeans("파일")).toBe("파일로")
  expect(withMeans("B30")).toBe("B30으로")
  expect(withMeans("B1")).toBe("B1로")
})

test("expressions read a file's values; unknown names wait for the run", () => {
  const file = { EXPTIME: "30.0", FILTER: " V " } as Record<string, string>
  const read = (text: string) => evaluateExpression(text, (name) => file[name])
  expect(read("EXPTIME > 20 && FILTER == \"V\"")).toBe(true)
  expect(read("!(EXPTIME > 20) || 2 ** 3 == 8")).toBe(true)
  expect(read("nint(EXPTIME / 7)")).toBe(4)
  expect(read("AIRMASS > 1")).toBeUndefined()
  expect(read("EXPTIME >")).toBeUndefined()
  expect([true, 30, 2.5, " B "].map((v) => expressionText(v))).toEqual(["True", "30.0", "2.5", "B"])
})

test("a chip sits where an edge enters a region, moved along it past another chip", () => {
  const points = pathPoints("M0,50 C50,50 50,50 200,50")
  const rect = { x: 100, y: 0, width: 200, height: 200 }
  expect(borderCrossing(points, rect)).toEqual({ x: 100, y: 50 })
  const moved = chipPlace(points, rect, { width: 40, height: 20 }, [{ x: 100, y: 50, width: 40, height: 20 }])!
  expect(moved.x).toBeGreaterThanOrEqual(140)
  expect(pathPoints("M0,0 L10,0 Q20,0 20,10 L20,20").at(-1)).toEqual({ x: 20, y: 20 })
})

test("keywords of the split files: one per meaning, the uninformative ones folded", () => {
  const source: Spec = {
    name: "src", title: "src", package: "images", adapter: "generic", parameters: [],
    inputs: [], outputs: [{ name: "output", kind: "image", default: "p_", mode: "each" }], output: null, kind: "image",
  }
  const region: Spec = { ...source, name: "giraf.foreach", run: "foreach", outputs: [] }
  const catalog: Catalog = { version: "t", tasks: [source, region], ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {} }
  const prefs = { drafts: {}, backend: "cl", mapping: { exptime: "EXPTIME" }, instrument: [], packageValues: {} }
  let map: TaskMap = addTask(emptyMap(), { ...makeInstance(source, catalog, prefs, "darks"), label: "darks" })
  const loop = { ...makeInstance(region, catalog, prefs, "loop"), label: "loop" }
  loop.draft = { ...loop.draft, flow: { criteria: [], split: { taskId: "darks" } } }
  map = addTask(map, loop)
  const frame = (id: string, headers: Record<string, string>): Frame => ({ id, label: id, asset: "image", role: "output", headers })
  const darks = [
    frame("a", { EXPTIME: "15", EXPOSURE: "15", IMAGETYP: "dark", "DATE-OBS": "1" }),
    frame("b", { EXPTIME: "15", EXPOSURE: "15", IMAGETYP: "dark", "DATE-OBS": "2" }),
    frame("c", { EXPTIME: "30", EXPOSURE: "30", IMAGETYP: "dark", "DATE-OBS": "3" }),
  ]
  map = { ...map, runs: [{ id: "r", instanceId: "darks", state: "completed", products: darks }] }
  const choices = flowKeywordChoices(map, catalog, map.tasks.find((t) => t.id === "loop")!, [])
  expect(choices.map((c) => [c.keyword, c.values.join(" "), c.counts.join(" "), c.folded, c.same.join(" ")])).toEqual([
    ["EXPTIME", "15 30", "2 1", false, "EXPOSURE"],
    ["IMAGETYP", "dark", "3", true, ""],
    ["DATE-OBS", "1 2 3", "1 1 1", true, ""],
  ])
})
