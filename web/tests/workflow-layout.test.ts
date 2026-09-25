import { beforeAll, expect, test } from "bun:test"
import { emptyMap, makeInstance, connect } from "../src/lib/task-map"
import { saveSubflow, autoLayoutMap } from "../src/lib/subflow"
import type { Catalog, Spec, Preferences } from "../src/lib/workbench"
import { nodeGeometry } from "../src/lib/node-interaction"
import { flowEdges } from "../src/lib/workflow-flow"
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
  output: { name: "output", mode: "each", default: "s_" },
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

test("ELK routes retain absolute port endpoints across groups and reach the renderer", async () => {
  let map = fixture()
  map = saveSubflow(map, catalog, { id: "dark", name: "Dark", taskIds: ["dark1", "dark2"] })
  map.view.edgeStyle = "smoothstep"
  const next = await autoLayoutMap(map, catalog)
  for (const edge of flowEdges(next, catalog)) {
    const points = edge.data?.points as { x: number; y: number }[]
    expect(points.length).toBeGreaterThanOrEqual(2)
    const source = next.tasks.find(t => t.id === edge.source)!
    const target = next.tasks.find(t => t.id === edge.target)!
    const geometry = nodeGeometry(next, source, catalog)
    const output = edge.sourceHandle === "output" ? { x: geometry.outputX, y: geometry.outputY } : geometry.outputs.find(p => p.handleId === edge.sourceHandle)!
    expect(points[0].x).toBeCloseTo(source.position!.x + output.x)
    expect(points[0].y).toBeCloseTo(source.position!.y + output.y)
    expect(points.at(-1)!.x).toBeCloseTo(target.position!.x)
    expect(points.at(-1)!.y).toBeCloseTo(target.position!.y + nodeGeometry(next, target, catalog).inputY("input"))
    for (let i = 1; i < points.length; i++)
      expect(points[i].x === points[i - 1].x || points[i].y === points[i - 1].y).toBe(true)
  }
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
