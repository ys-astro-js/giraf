import { expect, test } from "bun:test"
import {
  formulaValue,
  groupInputs,
  groupOutputName,
  keyChoices,
  outputSuffix,
  pairFiles,
  setSplit,
  splitGroups,
  splitIssues,
  taskGroups,
  toggledParts,
  withSuffix,
} from "../src/lib/splits"
import { migrateRegions } from "../src/lib/region-migration"
import { emptyMap, type Instance, type TaskMap } from "../src/lib/task-map"
import { makeDraft, type Catalog, type Frame } from "../src/lib/workbench"

const frame = (id: string, headers: Record<string, string> = {}): Frame => ({ id, label: id, headers })
const framesOf = (list: Frame[]) => new Map(list.map((f) => [f.id, f]))
const DARKS = [
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => frame(`d15_${n}.fits`, { EXPTIME: "15" })),
  ...[1, 2, 3].map((n) => frame(`d30_${n}.fits`, { EXPTIME: "30.0" })),
]
const SCIENCE = [
  frame("b1.fits", { FILTER: "B", EXPTIME: "90" }), frame("b2.fits", { FILTER: "B", EXPTIME: "90" }),
  frame("v1.fits", { FILTER: "V", EXPTIME: "60" }), frame("v2.fits", { FILTER: "V", EXPTIME: "60" }),
]
const CALIBRATIONS = [
  frame("Dark90.fits", { EXPTIME: "90.0" }), frame("Dark60.fits", { EXPTIME: "60" }),
  frame("FlatB.fits", { FILTER: "B" }), frame("FlatV.fits", { FILTER: "V" }),
]

test("a key groups by header value and sorts numbers as numbers", () => {
  const frames = framesOf([frame("a", { EXPTIME: "100" }), frame("b", { EXPTIME: "15.0" }), frame("c", { EXPTIME: "30" }), frame("d", { EXPTIME: "15" })])
  const groups = splitGroups(["a", "b", "c", "d"], [{ key: "EXPTIME" }], frames)!
  expect(groups.map((g) => [g.id, g.files])).toEqual([["15", ["b", "d"]], ["30", ["c"]], ["100", ["a"]]])
  expect(groups[0].keys).toEqual({ EXPTIME: "15" })
  // Text sorts as text; a file without the key is last.
  const text = splitGroups(["a", "b", "c"], [{ key: "FILTER" }], framesOf([frame("a", { FILTER: "V" }), frame("b", { FILTER: "B" }), frame("c", { OBJECT: "x" })]))!
  expect(text.map((g) => [g.id, g.name])).toEqual([["B", "B"], ["V", "V"], ["", "없음"]])
  // A keyword no file holds is the run's to read.
  expect(splitGroups(["a"], [{ key: "AIRMASS" }], framesOf([frame("a", { FILTER: "V" })]))).toBeUndefined()
})

test("per chunks in file name order, each makes a group per file, parts combine", () => {
  const ids = [10, 2, 1, 3, 4, 5, 6, 7, 8, 9, 11, 12].map((n) => `z${n}.fits`)
  const chunks = splitGroups(ids, [{ per: 5 }], framesOf(ids.map((id) => frame(id))))!
  expect(chunks.map((g) => g.name)).toEqual(["1–5", "6–10", "11–12"])
  expect(chunks[0].files).toEqual(["z1.fits", "z2.fits", "z3.fits", "z4.fits", "z5.fits"])
  expect(chunks.map((g) => [g.id, g.suffix])).toEqual([["1", "1"], ["2", "2"], ["3", "3"]])
  const each = splitGroups(["m67v.fits", "m67b.fits"], [{ each: true }], framesOf([frame("m67v.fits"), frame("m67b.fits")]))!
  expect(each.map((g) => [g.id, g.files])).toEqual([["m67b", ["m67b.fits"]], ["m67v", ["m67v.fits"]]])
  const darks = splitGroups(DARKS.map((f) => f.id), [{ key: "EXPTIME" }, { per: 5 }], framesOf(DARKS))!
  expect(darks.map((g) => [g.id, g.name, g.files.length, g.suffix])).toEqual([
    ["15/1", "15 1–5", 5, "15-1"], ["15/2", "15 6–7", 2, "15-2"], ["30/1", "30 1–3", 3, "30-1"],
  ])
})

test("output names take the group's suffix before the first dot", () => {
  expect(outputSuffix(["15", "1"], ["key", "per"])).toBe("15-1")
  expect(outputSuffix(["B", "90"], ["key", "key"])).toBe("B90")
  expect(withSuffix("Dark.fits", "15-1")).toBe("Dark15-1.fits")
  expect(withSuffix("Zero", "1")).toBe("Zero1")
  expect(withSuffix("m67.coo.1", "B")).toBe("m67B.coo.1")
  const [b] = splitGroups(["b1.fits"], [{ key: "FILTER" }], framesOf(SCIENCE))!
  expect(groupOutputName("NGC2420", b, 2)).toBe("NGC2420B")
  // One group, or a per-file name, keeps its name.
  expect(groupOutputName("NGC2420", b, 1)).toBe("NGC2420")
  expect(groupOutputName("{name}.mag.1", b, 2)).toBe("{name}.mag.1")
})

test("pairing follows the rule and never guesses", () => {
  const frames = framesOf([...SCIENCE, ...CALIBRATIONS])
  const groups = splitGroups(SCIENCE.map((f) => f.id), [{ key: "FILTER" }], frames)!
  expect(pairFiles("dark", { by: "EXPTIME" }, ["Dark60.fits", "Dark90.fits"], groups, frames)).toEqual({ files: { B: ["Dark90.fits"], V: ["Dark60.fits"] } })
  expect(pairFiles("flat", { by: "FILTER" }, ["FlatV.fits", "FlatB.fits"], groups, frames)).toEqual({ files: { B: ["FlatB.fits"], V: ["FlatV.fits"] } })
  expect(pairFiles("dark", { by: "EXPTIME" }, ["Dark90.fits", "FlatB.fits"], groups, frames)).toEqual({ error: "V: EXPTIME 60에 맞는 dark 파일이 없습니다." })
  expect(pairFiles("flat", { order: true }, ["FlatB.fits", "FlatV.fits"], groups, frames)).toEqual({ files: { B: ["FlatB.fits"], V: ["FlatV.fits"] } })
  expect("error" in pairFiles("flat", { order: true }, ["FlatB.fits"], groups, frames)).toBe(true)
  expect(pairFiles("flat", { iraf: true }, ["FlatB.fits", "FlatV.fits"], groups, frames)).toEqual({ files: { B: ["FlatB.fits", "FlatV.fits"], V: ["FlatB.fits", "FlatV.fits"] } })
  expect(pairFiles("flat", { manual: { B: "FlatV.fits", V: "FlatB.fits" } }, ["FlatB.fits", "FlatV.fits"], groups, frames)).toEqual({ files: { B: ["FlatV.fits"], V: ["FlatB.fits"] } })
  expect(pairFiles("flat", { manual: { B: "FlatB.fits" } }, ["FlatB.fits", "FlatV.fits"], groups, frames)).toEqual({ error: "V: flat 파일을 골라 주세요." })
  expect(pairFiles("flat", undefined, ["FlatB.fits", "FlatV.fits"], groups, frames)).toEqual({ error: "flat: 짝 맞추기를 정하세요", missing: true })
})

test("choices and part toggles", () => {
  const frames = framesOf(SCIENCE)
  expect(keyChoices(SCIENCE.map((f) => f.id), frames).map((c) => [c.key, c.values])).toEqual([["FILTER", ["B", "V"]], ["EXPTIME", ["60", "90"]]])
  expect(toggledParts([], { key: "EXPTIME" })).toEqual([{ key: "EXPTIME" }])
  expect(toggledParts([{ key: "EXPTIME" }], { per: 5 })).toEqual([{ key: "EXPTIME" }, { per: 5 }])
  // Keys stay ahead of a chunk; a file per group replaces chunks.
  expect(toggledParts([{ per: 5 }], { key: "FILTER" })).toEqual([{ key: "FILTER" }, { per: 5 }])
  expect(toggledParts([{ key: "FILTER" }, { per: 5 }], { each: true })).toEqual([{ key: "FILTER" }, { each: true }])
  expect(toggledParts([{ key: "FILTER" }], { key: "FILTER" })).toEqual([])
  expect(formulaValue("3 * fwhmpsf", (n) => (n === "fwhmpsf" ? "7.8" : undefined))).toBe("23.4")
  expect(formulaValue("3 * nope", () => undefined)).toBeUndefined()
})

const task = (id: string, extra: Partial<Instance> = {}): Instance => ({
  id, task: "imcombine", label: id, draft: makeDraft(), preprocess: makeDraft(), mapping: {}, instrument: [],
  packageValues: {}, backend: "cl", expressions: {}, filePolicy: { mode: "copy", backup: true }, ...extra,
})

test("a task's groups come from what its split input holds", () => {
  let map: TaskMap = { ...emptyMap(), tasks: [task("ccd")] }
  map.tasks[0].draft.inputs = { images: SCIENCE.map((f) => f.id), dark: ["Dark90.fits", "Dark60.fits"], zero: ["Zero.fits"] }
  map = { ...map, tasks: [setSplit(map.tasks[0], { input: "images", by: [{ key: "FILTER" }] })] }
  const rows = [...SCIENCE, ...CALIBRATIONS]
  const { groups } = taskGroups(map, map.tasks[0], rows)
  expect(groups!.map((g) => g.id)).toEqual(["B", "V"])
  expect(groupInputs(map, map.tasks[0], rows, "zero", groups!)).toEqual({ all: ["Zero.fits"] })
  expect(groupInputs(map, map.tasks[0], rows, "dark", groups!)).toMatchObject({ missing: true })
  map.tasks[0].draft.pairing = { dark: { by: "EXPTIME" } }
  expect(groupInputs(map, map.tasks[0], rows, "dark", groups!)).toEqual({ files: { B: ["Dark90.fits"], V: ["Dark60.fits"] } })
  // Clearing the split drops values set per group.
  const cleared = setSplit({ ...map.tasks[0], draft: { ...map.tasks[0].draft, groupValues: { combine: { B: "median" } } } }, undefined)
  expect([cleared.draft.split, cleared.draft.groupValues]).toEqual([undefined, undefined])
})

const catalog = { tasks: [] } as unknown as Catalog
const region = (id: string, flow: object, subflowId?: string): Instance =>
  task(id, { task: "giraf.foreach", draft: { ...makeDraft(), flow } as Instance["draft"], ...(subflowId ? { subflowId } : {}) })

test("a region around one task becomes its split; others are unwrapped with a warning", () => {
  const group = (id: string) => ({ id, name: id, position: { x: 0, y: 0 }, width: 400, height: 200 })
  const dc = task("dc", { subflowId: "r" })
  dc.draft.outputs = { output: "Dark{EXPTIME}_{묶음}.fits" }
  const map: TaskMap = {
    ...emptyMap(),
    tasks: [task("darks"), task("zero"), dc, region("r", { criteria: [{ keyword: "EXPTIME" }, { count: 5, order: "name" }], split: { taskId: "darks" } })],
    subflows: [group("r")],
    connections: [
      { id: "a", target: "dc", role: "input", source: { kind: "pending", taskId: "darks" } },
      { id: "b", target: "dc", role: "zero", source: { kind: "pending", taskId: "zero" }, flow: { r: { mode: "match", keys: ["EXPTIME"] } } },
    ] as TaskMap["connections"],
  }
  const migrated = migrateRegions(map, catalog)
  const done = migrated.tasks.find((t) => t.id === "dc")!
  expect(done.draft.split).toEqual({ input: "input", by: [{ key: "EXPTIME" }, { per: 5 }] })
  expect(done.draft.pairing).toEqual({ zero: { by: "EXPTIME" } })
  expect(done.draft.outputs).toEqual({ output: "Dark.fits" })
  expect([done.subflowId, done.migrated]).toEqual([undefined, undefined])
  expect(migrated.tasks.map((t) => t.id)).toEqual(["darks", "zero", "dc"])
  expect(migrated.subflows).toEqual([])
  expect(migrated.connections.every((c) => !("flow" in c))).toBe(true)
  expect(splitIssues(migrated)).toEqual([])
  // A task the region's files do not reach, an expression or N번 cannot be said: the tasks stay and warn.
  const two: TaskMap = { ...map, tasks: [...map.tasks, task("other", { subflowId: "r" })] }
  const unwrapped = migrateRegions(two, catalog)
  expect(unwrapped.tasks.filter((t) => t.migrated).map((t) => t.id)).toEqual(["other"])
  expect(splitIssues(unwrapped).map((i) => i.nodeId)).toEqual(["other"])
  // Setting the split settles the warning.
  expect(setSplit(unwrapped.tasks.find((t) => t.id === "other")!, { input: "input", by: [{ key: "EXPTIME" }] }).migrated).toBeUndefined()
  for (const criteria of [[{ expression: "EXPTIME > 10", name: "long" }], [{ times: 3 }]]) {
    const odd = migrateRegions({ ...map, tasks: map.tasks.map((t) => (t.id === "r" ? region("r", { criteria, split: { taskId: "darks" } }) : t)) }, catalog)
    expect(odd.tasks.find((t) => t.id === "dc")!.migrated).toBe(true)
  }
  // Nested regions on one source split by the outer criteria, then the inner.
  const nested: TaskMap = {
    ...map,
    tasks: [task("darks"), task("zero"), { ...dc, subflowId: "inner" }, region("inner", { criteria: [{ count: 5 }], split: { taskId: "darks" } }, "outer"),
      region("outer", { criteria: [{ keyword: "EXPTIME" }], split: { taskId: "darks" } })],
    subflows: [group("outer"), group("inner")],
  }
  const flat = migrateRegions(nested, catalog)
  expect(flat.tasks.map((t) => [t.id, t.draft.split?.by, t.migrated])).toEqual([
    ["darks", undefined, undefined], ["zero", undefined, undefined], ["dc", [{ key: "EXPTIME" }, { per: 5 }], undefined],
  ])
})
