// Contracts authored before implementation.
import { expect, test } from "bun:test"
import { emptyMap, makeInstance, addTask, connect } from "../src/lib/task-map"
import {
  saveSubflow,
  dissolveSubflow,
  subflowRequest,
  updateSubflow,
  moveTaskToSubflow,
  subflowDropTarget,
} from "../src/lib/subflow"
import { flowNodes, flowEdges, changeFlowNodes, flowPortColors } from "../src/lib/workflow-flow"
import type { Catalog, Preferences, Spec } from "../src/lib/workbench"
const spec: Spec = {
  name: "ccdproc",
  title: "CCD 보정",
  package: "ccdred",
  parameters: [],
  inputs: [{ name: "images", label: "영상", kind: "image", multiple: true }],
  output: { name: "output", mode: "each", default: "p_" },
  kind: "image",
}
const catalog: Catalog = {
  version: "test",
  tasks: [spec],
  ccdproc: { parameters: [], inputs: spec.inputs },
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
const fixture = () =>
  ["a", "b", "c"].reduce(
    (m, id, i) =>
      addTask(m, {
        ...makeInstance(spec, catalog, prefs, id),
        position: { x: i * 400, y: 100 },
      }),
    emptyMap()
  )
const group = (m = fixture()) =>
  saveSubflow(m, catalog, { id: "group", name: "보정", taskIds: ["a", "b"] })
test("both edge modes highlight selected connections and match their ports", () => {
  let map = connect(fixture(), "b", "images", { kind: "pending", taskId: "a" })
  map = connect(map, "c", "images", { kind: "pending", taskId: "a" })
  map = saveSubflow(map, catalog, { id: "source", name: "출발", taskIds: ["a"], color: "rose" })
  map = saveSubflow(map, catalog, { id: "target", name: "대상", taskIds: ["b"], color: "blue" })
  for (const edgeStyle of ["default", "smoothstep"] as const) {
    map.view.edgeStyle = edgeStyle
    for (const selected of ["", "c"]) {
      map.view.selected = selected
      expect(flowEdges(map, catalog)[0].style).not.toHaveProperty("--xy-edge-stroke")
    }
    for (const selected of ["a", "b"]) {
      map.view.selected = selected
      expect(flowEdges(map, catalog)[0].style).toMatchObject({ "--xy-edge-stroke": "var(--subflow-blue)" })
      expect(flowPortColors(flowEdges(map, catalog), "b", "target", "images")).toEqual(["var(--subflow-blue)"])
      expect(flowPortColors(flowEdges(map, catalog), "b", "target", "unrelated")).toEqual([])
    }
  }
  map.view.selected = "a"
  const edges = flowEdges(map, catalog)
  expect(flowPortColors(edges, "a", "source", "output")).toEqual(["var(--subflow-blue)"])
  const branched = saveSubflow(map, catalog, { id: "other", name: "다른 대상", taskIds: ["c"], color: "rose" })
  expect(flowPortColors(flowEdges(branched, catalog), "a", "source", "output")).toEqual(["var(--subflow-blue)", "var(--subflow-rose)"])
  expect(edges.find(e => e.target === "b")!.style).toMatchObject({ "--xy-edge-stroke": "var(--subflow-blue)" })
  expect(edges.find(e => e.target === "c")!.style).not.toHaveProperty("--xy-edge-stroke")
  const recolored = updateSubflow(map, "target", { name: "대상", color: "violet" })
  expect(flowEdges(recolored, catalog)[0].style).toMatchObject({ "--xy-edge-stroke": "var(--subflow-violet)" })
  expect(flowEdges(dissolveSubflow(map, "target"), catalog)[0].style).not.toHaveProperty("--xy-edge-stroke")
  map.view.selected = ""
  expect(flowEdges(map, catalog)[0].style).not.toHaveProperty("--xy-edge-stroke")
})
test("group persistence, parent ordering and relative coordinates", () => {
  const m = group(),
    nodes = flowNodes(m, catalog),
    parent = nodes.find((n) => n.id === "group")!,
    child = nodes.find((n) => n.id === "a")!
  expect(nodes[0].id).toBe("group")
  expect(child.parentId).toBe("group")
  const wired = connect(m, "b", "images", { kind: "pending", taskId: "a" })
  const edge = flowEdges(wired, catalog)[0]
  expect(parent.zIndex).toBeLessThan(edge.zIndex!)
  expect(child.zIndex).toBeGreaterThan(edge.zIndex!)
  expect(nodes.find(n => n.id === "c")!.zIndex).toBeGreaterThan(edge.zIndex!)
  expect(child.extent).toBeUndefined()
  expect(child.position.x + parent.position.x).toBe(0)
  expect(child.position.y + parent.position.y).toBe(100)
  expect(JSON.parse(JSON.stringify(m)).subflows[0].name).toBe("보정")
  expect(() => structuredClone(nodes)).not.toThrow()
  const searched = flowNodes(m, catalog, "no-match")
  expect(searched.every((n) => !n.hidden)).toBe(true)
  expect(searched.filter((n) => n.type === "task").every((n) => n.style?.opacity === 0.3)).toBe(true)
  expect(searched.find((n) => n.id === "a")!.parentId).toBe("group")
})
test("parent moves carry children and child moves persist absolute coordinates", () => {
  const m = group(),
    p = m.subflows![0]
  const moved = changeFlowNodes(m, catalog, [
    {
      id: "group",
      type: "position",
      position: { x: p.position.x + 70, y: p.position.y - 20 },
    },
  ])
  expect(moved.tasks[0].position).toEqual({ x: 70, y: 80 })
  expect(moved.tasks[2].position).toEqual(m.tasks[2].position)
  const child = changeFlowNodes(moved, catalog, [
    { id: "a", type: "position", position: { x: 40, y: 90 } },
  ])
  expect(child.tasks[0].position).toEqual({
    x: moved.subflows![0].position.x + 40,
    y: moved.subflows![0].position.y + 90,
  })
})
test("membership editing and dissolve retain tasks, links and positions; invalid groups rejected", () => {
  const linked = connect(
    fixture(),
    "b",
    "images",
    { kind: "pending", taskId: "a" },
    false
  )
  const m = saveSubflow(group(linked), catalog, {
    id: "group",
    name: "이름 변경",
    taskIds: ["b", "c"],
  })
  expect(m.tasks[0].subflowId).toBeUndefined()
  expect(m.tasks[2].subflowId).toBe("group")
  const out = dissolveSubflow(m, "group")
  expect(out.subflows).toEqual([])
  expect(out.tasks.map((t) => t.position)).toEqual(
    m.tasks.map((t) => t.position)
  )
  expect(out.connections).toEqual(linked.connections)
  expect(() =>
    saveSubflow(m, catalog, { id: "other", name: "다른 그룹", taskIds: ["b"] })
  ).toThrow()
  expect(() =>
    saveSubflow(m, catalog, { id: "group", name: " ", taskIds: ["b"] })
  ).toThrow()
  expect(() =>
    saveSubflow(m, catalog, { id: "group", name: "보정", taskIds: [] })
  ).toThrow()
})
test("execution scopes internal dependencies and preserves external frozen results", () => {
  let m = connect(
    fixture(),
    "b",
    "images",
    { kind: "pending", taskId: "a" },
    false
  )
  m = connect(
    m,
    "a",
    "images",
    { kind: "result", taskId: "c", runId: "previous", ids: ["image-1"] },
    false
  )
  const req = subflowRequest(group(m), catalog, "/work", "group")
  expect(req.nodes.map((n) => n.id)).toEqual(["a", "b"])
  expect(req.links.map((l) => l.source)).toEqual(["a"])
  expect(req.nodes[0].payload.inputs.images).toEqual(["image-1"])
  expect(req.nodes[0].payload.workingDirectory).toBe("/work")
})
test("external pending inputs block; expressions bypass unused dependencies; missing or empty groups reject", () => {
  const m = group(
    connect(fixture(), "a", "images", { kind: "pending", taskId: "c" }, false)
  )
  expect(() => subflowRequest(m, catalog, "/work", "group")).toThrow("외부")
  m.tasks[0].expressions.images = "*.fits"
  expect(subflowRequest(m, catalog, "/work", "group").nodes).toHaveLength(2)
  expect(() => subflowRequest(m, catalog, "/work", "missing")).toThrow()
  expect(() =>
    subflowRequest(
      { ...m, tasks: m.tasks.filter((t) => !t.subflowId) },
      catalog,
      "/work",
      "group"
    )
  ).toThrow()
})

// Direct canvas editing contracts, recorded before this implementation.
test("group colors persist across geometry updates and metadata editing keeps membership", () => {
  const m = saveSubflow(fixture(), catalog, {
    id: "group",
    name: "보정",
    taskIds: ["a"],
    color: "blue",
  })
  expect(m.subflows![0].color).toBe("blue")
  const renamed = updateSubflow(m, "group", { name: "새 이름", color: "rose" })
  expect(renamed.tasks).toEqual(m.tasks)
  expect(renamed.subflows![0]).toMatchObject({
    name: "새 이름",
    color: "rose",
    position: m.subflows![0].position,
  })
  const regrouped = saveSubflow(renamed, catalog, {
    id: "group",
    name: "새 이름",
    taskIds: ["a", "b"],
  })
  expect(regrouped.subflows![0].color).toBe("rose")
})
test("drag targets use the node center, exclude headers and choose the smaller overlapping group", () => {
  const groups = [
    {
      id: "large",
      name: "큰 그룹",
      position: { x: 0, y: 0 },
      width: 800,
      height: 600,
    },
    {
      id: "small",
      name: "작은 그룹",
      position: { x: 100, y: 100 },
      width: 400,
      height: 350,
    },
  ]
  expect(
    subflowDropTarget(groups, { x: 150, y: 180, width: 100, height: 100 })
  ).toBe("small")
  expect(
    subflowDropTarget(groups, { x: 100, y: 0, width: 40, height: 40 })
  ).toBeUndefined()
  expect(
    subflowDropTarget(groups, { x: 790, y: 550, width: 100, height: 100 })
  ).toBeUndefined()
})
test("drag in, out and between groups preserves absolute placement, links and colors", () => {
  let m = group(
    connect(fixture(), "b", "images", { kind: "pending", taskId: "a" }, false)
  )
  m = saveSubflow(m, catalog, {
    id: "second",
    name: "다음",
    taskIds: ["c"],
    color: "violet",
  })
  const outside = moveTaskToSubflow(m, catalog, "a", undefined, {
    x: -400,
    y: -100,
  })
  expect(outside.tasks[0]).toMatchObject({
    position: { x: -400, y: -100 },
    subflowId: undefined,
  })
  expect(outside.subflows).toEqual(m.subflows)
  const inside = moveTaskToSubflow(outside, catalog, "a", "second", {
    x: 900,
    y: 200,
  })
  expect(inside.tasks[0]).toMatchObject({
    position: { x: 900, y: 200 },
    subflowId: "second",
  })
  expect(inside.connections).toEqual(m.connections)
  expect(inside.subflows!.find((g) => g.id === "second")!.color).toBe("violet")
  expect(flowNodes(inside, catalog).find((n) => n.id === "a")!.parentId).toBe(
    "second"
  )
})
test("children can leave fixed parent bounds without growing the group during a drag", () => {
  const m = group()
  const before = flowNodes(m, catalog).find((n) => n.id === "group")!
  const moved = changeFlowNodes(m, catalog, [
    {
      id: "a",
      type: "position",
      position: { x: -300, y: -200 },
      dragging: true,
    },
  ])
  expect(moved.tasks[0].position!.x).toBe(m.subflows![0].position.x - 300)
  expect(
    flowNodes(moved, catalog).find((n) => n.id === "group")!.style
  ).toEqual(before.style)
  expect(
    flowNodes(m, catalog).find((n) => n.id === "a")!.extent
  ).toBeUndefined()
})
