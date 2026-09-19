import { beforeAll, expect, test } from "bun:test"
import { emptyMap, makeInstance, connect } from "../src/lib/task-map"
import { saveSubflow, autoLayoutMap } from "../src/lib/subflow"
import type { Catalog, Spec, Preferences } from "../src/lib/workbench"
// Bun exposes `self` in its main thread; ELK otherwise mistakes it for a worker.
beforeAll(async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self")
  Reflect.deleteProperty(globalThis, "self")
  try { const {default: ELK} = await import("elkjs/lib/elk.bundled.js"); new ELK() }
  finally { if (descriptor) Object.defineProperty(globalThis, "self", descriptor) }
})
const spec: Spec = {
  name: "stack",
  title: "stack",
  package: "images",
  parameters: [],
  inputs: [{ name: "input", label: "input", kind: "image", multiple: true }],
  output: null,
  kind: "image",
}
const catalog: Catalog = {
  version: "1",
  tasks: [spec],
  ccdproc: { parameters: [], inputs: [] },
  ccdred: [],
  exam: {},
}
const prefs: Preferences = {
  drafts: {},
  backend: "cl",
  mapping: {},
  instrument: [],
  packageValues: {},
}
function fixture() {
  let map = {
    ...emptyMap(),
    tasks: ["bias", "dark1", "dark2", "science", "result"].map((id) =>
      makeInstance(spec, catalog, prefs, id)
    ),
  }
  for (const [source, target] of [
    ["bias", "dark1"],
    ["dark1", "dark2"],
    ["dark2", "science"],
    ["science", "result"],
  ])
    map = connect(map, target, "input", { kind: "pending", taskId: source })
  return map
}
test("late-created predecessor group is placed before consuming groups", async () => {
  let map = fixture()
  for (const [id, taskIds] of [
    ["Bias", ["bias"]],
    ["Processing", ["science"]],
    ["Stacking", ["result"]],
    ["Dark", ["dark1", "dark2"]],
  ] as [string, string[]][])
    map = saveSubflow(map, catalog, { id, name: id, taskIds, color: "blue" })
  const next = await autoLayoutMap(map, catalog)
  const group = (id: string) => next.subflows!.find((g) => g.id === id)!
  expect(group("Bias").position.x + group("Bias").width).toBeLessThan(
    group("Dark").position.x
  )
  expect(group("Dark").position.x + group("Dark").width).toBeLessThan(
    group("Processing").position.x
  )
  expect(group("Processing").position.x).toBeLessThan(
    group("Stacking").position.x
  )
  expect(next.tasks.find((t) => t.id === "dark1")!.position!.x).toBeLessThan(
    next.tasks.find((t) => t.id === "dark2")!.position!.x
  )
  expect(next.connections).toEqual(map.connections)
  expect(next.subflows!.every((g) => g.color === "blue")).toBe(true)
  expect(await autoLayoutMap(next, catalog)).toEqual(next)
})
test("ungrouped predecessors and consumers participate in the same dependency order", async () => {
  const map = saveSubflow(fixture(), catalog, {
    id: "dark",
    name: "Dark",
    taskIds: ["dark1", "dark2"],
  })
  const next = await autoLayoutMap(map, catalog),
    group = next.subflows![0]
  expect(next.tasks.find((t) => t.id === "bias")!.position!.x).toBeLessThan(
    group.position.x
  )
  expect(group.position.x + group.width).toBeLessThan(
    next.tasks.find((t) => t.id === "science")!.position!.x
  )
})
test("interleaved group dependencies terminate and retain every task", async () => {
  let map = fixture()
  map = saveSubflow(map, catalog, {
    id: "a",
    name: "A",
    taskIds: ["bias", "science"],
  })
  map = saveSubflow(map, catalog, {
    id: "b",
    name: "B",
    taskIds: ["dark1", "dark2"],
  })
  const next = await autoLayoutMap(map, catalog)
  expect(next.tasks.map((t) => t.id)).toEqual(map.tasks.map((t) => t.id))
  expect(next.tasks.every((t) => Number.isFinite(t.position?.x))).toBe(true)
  expect(next.connections).toEqual(map.connections)
})

test("empty maps retain metadata", async () => {
  const map = emptyMap()
  expect(await autoLayoutMap(map, catalog)).toEqual(map)
})
test("multiple output ports preserve data and fit inside group bounds", async () => {
  let map = fixture()
  map.tasks[0].outputPorts = [{id: "custom", name: "Master", files: ["*.fits"]}]
  map.connections[0].source.port = "output-custom:custom"
  map = saveSubflow(map, catalog, {id: "all", name: "All", taskIds: map.tasks.map(t => t.id)})
  const before = JSON.stringify(map)
  const next = await autoLayoutMap(map, catalog)
  const group = next.subflows![0]
  expect(JSON.stringify(map)).toBe(before)
  expect(next.tasks[0].outputPorts).toEqual(map.tasks[0].outputPorts)
  expect(next.connections).toEqual(map.connections)
  expect(next.runs).toEqual(map.runs)
  expect(next.view).toEqual(map.view)
  for (const task of next.tasks) {
    expect(task.position!.x).toBeGreaterThanOrEqual(group.position.x + 24)
    expect(task.position!.y).toBeGreaterThanOrEqual(group.position.y + 72)
    expect(task.position!.x + 280).toBeLessThan(group.position.x + group.width)
  }
})
