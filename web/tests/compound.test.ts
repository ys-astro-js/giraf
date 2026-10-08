import { beforeAll, expect, test } from "bun:test"
import { emptyMap, makeInstance, addTask, connect } from "../src/lib/task-map"
import { saveSubflow, setSubflowCollapsed, autoLayoutMap } from "../src/lib/subflow"
import { compoundPorts, compoundStatus, memberConnection } from "../src/lib/compound"
import { flowNodes, flowEdges, taskEdges, connectFlow, connectionFeedback, changeFlowNodes } from "../src/lib/workflow-flow"
import type { Catalog, Preferences, Spec } from "../src/lib/workbench"

beforeAll(async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self")
  Reflect.deleteProperty(globalThis, "self")
  try { const { default: ELK } = await import("elkjs/lib/elk.bundled.js"); new ELK() }
  finally { if (descriptor) Object.defineProperty(globalThis, "self", descriptor) }
})
const spec: Spec = {
  name: "stack",
  title: "stack",
  package: "images",
  parameters: [],
  inputs: [{ name: "images", label: "영상", kind: "image", multiple: true }],
  output: { name: "output", mode: "each", default: "s_" },
  kind: "image",
}
const catalog: Catalog = {
  version: "test",
  tasks: [spec],
  ccdproc: { parameters: [], inputs: [] },
  ccdred: [],
  exam: {},
}
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }

// a → [b → c] → d, with e unconnected outside the group.
function fixture() {
  let map = ["a", "b", "c", "d", "e"].reduce(
    (m, id, i) =>
      addTask(m, { ...makeInstance(spec, catalog, prefs, id), label: id.toUpperCase(), position: { x: i * 400, y: 100 } }),
    emptyMap()
  )
  map = connect(map, "b", "images", { kind: "pending", taskId: "a" })
  map = connect(map, "c", "images", { kind: "pending", taskId: "b" })
  map = connect(map, "d", "images", { kind: "pending", taskId: "c" })
  map = saveSubflow(map, catalog, { id: "g", name: "보정", taskIds: ["b", "c"], color: "blue" })
  return setSubflowCollapsed(map, "g", true)
}

test("collapsing persists in the map and clears a hidden selection", () => {
  const open = saveSubflow(fixture(), catalog, { id: "g", name: "보정", taskIds: ["b", "c"] })
  const selected = { ...open, view: { ...open.view, selected: "b" } }
  const collapsed = setSubflowCollapsed(selected, "g", true)
  expect(collapsed.subflows![0].collapsed).toBe(true)
  expect(collapsed.view.selected).toBe("")
  expect(setSubflowCollapsed({ ...open, view: { ...open.view, selected: "a" } }, "g", true).view.selected).toBe("a")
  expect(setSubflowCollapsed(collapsed, "g", false).subflows![0].collapsed).toBeUndefined()
})

test("boundary ports come from connections crossing the group", () => {
  let map = fixture()
  map = connect(map, "b", "images", { kind: "pending", taskId: "e" }, true)
  const { inputs, outputs, width, height } = compoundPorts(map, map.subflows![0], taskEdges(map, catalog))
  expect(inputs.map((r) => [r.handleId, r.label, r.summary])).toEqual([["in:b:images", "images", "A, E"]])
  expect(outputs.map((r) => [r.handleId, r.label])).toEqual([["out:c:output", "C 결과"]])
  expect(width).toBe(320)
  expect(outputs[0].y).toBeGreaterThan(inputs[0].y)
  expect(height).toBeGreaterThan(outputs[0].y)
  const named = { ...map, tasks: map.tasks.map((t) => t.id === "c" ? { ...t, outputPorts: [{ id: "$default", name: "보정 영상", files: [] }] } : t) }
  expect(compoundPorts(named, named.subflows![0], taskEdges(named, catalog)).outputs[0].label).toBe("보정 영상")
})

test("a collapsed group draws one compound node and hides its members", () => {
  const map = fixture()
  const nodes = flowNodes(map, catalog)
  const compound = nodes.find((n) => n.id === "g")!
  expect(compound.type).toBe("compound")
  expect(compound.position).toEqual(map.subflows![0].position)
  expect(compound.handles?.map((h) => [h.id, h.type])).toEqual([["in:b:images", "target"], ["out:c:output", "source"]])
  expect(nodes.filter((n) => n.hidden).map((n) => n.id).sort()).toEqual(["b", "c"])
  const expanded = flowNodes(setSubflowCollapsed(map, "g", false), catalog)
  expect(expanded.find((n) => n.id === "g")!.type).toBe("subflow")
  expect(expanded.some((n) => n.hidden)).toBe(false)
})

test("edges re-point to compound handles; inner edges hide", () => {
  const map = fixture()
  const edges = flowEdges(map, catalog)
  const by = (target: string) => map.connections.find((c) => c.target === target)!.id
  expect(edges.find((e) => e.id === by("b"))).toMatchObject({ source: "a", target: "g", targetHandle: "in:b:images", data: { role: "images" } })
  expect(edges.find((e) => e.id === by("c"))!.hidden).toBe(true)
  expect(edges.find((e) => e.id === by("d"))).toMatchObject({ source: "g", sourceHandle: "out:c:output", target: "d", targetHandle: "images" })
  // Raw task edges stay available for dependency views.
  expect(taskEdges(map, catalog).find((e) => e.id === by("d"))!.source).toBe("c")
  expect(flowEdges(setSubflowCollapsed(map, "g", false), catalog).every((e) => !e.hidden)).toBe(true)
})

test("connections to compound handles address the member's port", () => {
  const map = fixture()
  const out = { source: "g", sourceHandle: "out:c:output", target: "e", targetHandle: "images" }
  expect(memberConnection(map, out)).toEqual({ ...out, source: "c", sourceHandle: "output" })
  const into = { source: "e", sourceHandle: "output", target: "g", targetHandle: "in:b:images" }
  expect(memberConnection(map, into)).toEqual({ ...into, target: "b", targetHandle: "images" })
  // Task handles are left alone.
  expect(memberConnection(map, { ...out, source: "d" })).toEqual({ ...out, source: "d" })
  const linked = connectFlow(map, catalog, [], out)
  expect(linked.connections.find((c) => c.target === "e")!.source).toMatchObject({ kind: "pending", taskId: "c" })
  const appended = connectFlow(map, catalog, [], into)
  expect(appended.connections.filter((c) => c.target === "b").map((c) => "taskId" in c.source && c.source.taskId).sort()).toEqual(["a", "e"])
  expect(connectionFeedback(map, catalog, [], { source: "g", sourceHandle: "out:c:output", target: "a", targetHandle: "images" }).valid).toBe(false)
  // Reconnecting an edge from a compound port keeps the member as its source.
  const edge = map.connections.find((c) => c.target === "d")!
  const moved = connectFlow(map, catalog, [], { source: "g", sourceHandle: "out:c:output", target: "e", targetHandle: "images" }, edge.id)
  expect(moved.connections.some((c) => c.id === edge.id)).toBe(false)
  expect(moved.connections.find((c) => c.target === "e")!.source).toMatchObject({ taskId: "c" })
})

test("aggregated status: diagnostics, then activity, then all completed", () => {
  const map = fixture()
  const run = (instanceId: string, state: string) => ({ id: instanceId + state, instanceId, state, products: [] })
  const issue = (nodeId: string, severity: "error" | "warning") => ({ id: nodeId, nodeId, severity, message: "x", source: "t", timestamp: 0 })
  expect(compoundStatus(map, ["b", "c"], []).state).toBeUndefined()
  expect(compoundStatus({ ...map, runs: [run("b", "completed")] }, ["b", "c"], []).state).toBeUndefined()
  expect(compoundStatus({ ...map, runs: [run("b", "completed"), run("c", "completed")] }, ["b", "c"], []).state).toBe("completed")
  expect(compoundStatus({ ...map, runs: [run("b", "queued")] }, ["b", "c"], []).state).toBe("running")
  expect(compoundStatus(map, ["b", "c"], [issue("c", "warning"), issue("a", "error")]).severity).toBe("warning")
  expect(compoundStatus(map, ["b", "c"], [issue("c", "warning"), issue("b", "error")]).severity).toBe("error")
})

test("dragging the compound moves the group and its members together", () => {
  const map = fixture()
  const group = map.subflows![0]
  const moved = changeFlowNodes(map, catalog, [{ id: "g", type: "position", position: { x: group.position.x + 50, y: group.position.y + 20 } }])
  const before = map.tasks.find((t) => t.id === "b")!.position!
  expect(moved.tasks.find((t) => t.id === "b")!.position).toEqual({ x: before.x + 50, y: before.y + 20 })
  expect(moved.subflows![0]).toMatchObject({ width: group.width, height: group.height, collapsed: true })
})

test("auto layout treats a collapsed group as one node and keeps member offsets", async () => {
  const map = fixture()
  const group = map.subflows![0]
  const offset = (m: typeof map, id: string) => {
    const t = m.tasks.find((t) => t.id === id)!.position!, g = m.subflows![0].position
    return { x: t.x - g.x, y: t.y - g.y }
  }
  const laid = await autoLayoutMap(map, catalog)
  expect(laid.subflows![0]).toMatchObject({ width: group.width, height: group.height, collapsed: true })
  expect(offset(laid, "b")).toEqual(offset(map, "b"))
  expect(offset(laid, "c")).toEqual(offset(map, "c"))
  const route = laid.edgeRoutes![map.connections.find((c) => c.target === "d")!.id]
  expect(route).toMatchObject({ source: "g", sourceHandle: "out:c:output", target: "d" })
  expect(flowEdges(laid, catalog).find((e) => e.target === "d")!.data!.points).toEqual(route.points)
})
