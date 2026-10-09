import { beforeAll, expect, test } from "bun:test"
import { emptyMap, makeInstance, addTask, removeTask, duplicateTask, restoreTask, workflowRequest, workflowDiagnosticRequest, migrateMap } from "../src/lib/task-map"
import { setSubflowCollapsed, autoLayoutMap, moveTaskToSubflow, subflowRequest, updateSubflow, dissolveSubflow } from "../src/lib/subflow"
import { compoundPorts } from "../src/lib/compound"
import { addContainer, containerLabel, flowPorts, flowStatement, syncContainerItems, loopOutputNames, loopVariable, FLOW_HEADER } from "../src/lib/containers"
import { flowNodes, flowEdges, taskEdges, connectFlow, connectionFeedback } from "../src/lib/workflow-flow"
import { nodeLayout } from "../src/lib/node-interaction"
import { plannedOutputs, type Catalog, type Preferences, type Spec } from "../src/lib/workbench"
import type { TaskMap } from "../src/lib/task-map"

beforeAll(async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self")
  Reflect.deleteProperty(globalThis, "self")
  try { const { default: ELK } = await import("elkjs/lib/elk.bundled.js"); new ELK() }
  finally { if (descriptor) Object.defineProperty(globalThis, "self", descriptor) }
})

const param = (name: string, type: string) => ({ name, type, default: "", choices: [], prompt: "", min: "", max: "" })
const task = (name: string): Spec => ({
  name,
  title: name,
  package: "images",
  adapter: "generic",
  parameters: [param("aperture", "r")],
  inputs: [{ name: "images", label: "영상", kind: "image", multiple: true }],
  outputs: [{ name: "output", kind: "image", default: "p_", mode: "each" }],
  output: null,
  kind: "image",
})
const flow = (run: "foreach" | "for" | "if", input?: string): Spec => ({
  name: "giraf." + run,
  title: run,
  taskName: run,
  package: "giraf",
  adapter: "generic",
  run,
  parameters: [],
  inputs: input ? [{ name: input, label: input === "items" ? "목록" : "입력", kind: "any", multiple: true, sources: ["node"] }] : [],
  outputs: [],
  output: null,
  kind: "any",
})
const catalog: Catalog = {
  version: "test",
  tasks: [task("ccdproc2"), flow("foreach", "items"), flow("for"), flow("if", "input")],
  ccdproc: { parameters: [], inputs: [] },
  ccdred: [],
  exam: {},
}
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const spec = (name: string) => catalog.tasks.find((s) => s.name === name)!

/** object → [foreach: proc] → combine; the container's id is its group's. */
function fixture(run: "foreach" | "for" | "if" = "foreach") {
  let map = ["object", "proc", "combine"].reduce(
    (m, id, i) => addTask(m, { ...makeInstance(spec("ccdproc2"), catalog, prefs, id), label: id, position: { x: i * 800, y: 100 } }),
    emptyMap()
  )
  map = addContainer(map, catalog, spec("giraf." + run), prefs, nodeLayout(map, catalog))
  const id = map.subflows![0].id
  map = { ...map, subflows: map.subflows!.map((g) => ({ ...g, position: { x: 360, y: 40 }, width: 400, height: 280 })) }
  map = moveTaskToSubflow(map, catalog, "proc", id, { x: 440, y: 140 })
  return { map, id }
}
const wire = (map: TaskMap, source: string, sourceHandle: string, target: string, targetHandle: string) =>
  connectFlow(map, catalog, [], { source, sourceHandle, target, targetHandle })

test("a container is a task and a group with one id, drawn as the group", () => {
  const { map, id } = fixture()
  expect(map.tasks.find((t) => t.id === id)!.draft.flow).toEqual({ variable: "파일" })
  expect(map.view.selected).toBe(id)
  const nodes = flowNodes(map, catalog)
  expect(nodes.filter((n) => n.id === id).map((n) => n.type)).toEqual(["subflow"])
  const group = nodes.find((n) => n.id === id)!
  expect(group.selected).toBe(true)
  expect(group.deletable).toBe(true)
  expect(group.handles!.map((h) => [h.id, h.type])).toEqual([
    ["items", "target"], ["output:item", "source"], ["result", "target"], ["output:results", "source"],
  ])
  // The container's task never takes a place among the task nodes.
  const layout = nodeLayout(map, catalog)
  expect(layout.find((n) => n.id === id)).toMatchObject({ width: 0, height: 0 })
  expect(layout.find((n) => n.id === "combine")!.y).toBe(100)
})

test("the heading reads as a statement for each kind", () => {
  const made = fixture()
  const id = made.id
  let map = made.map
  map = wire(map, "object", "output", id, "items")
  expect(flowStatement(map, catalog, map.tasks.find((t) => t.id === id)!)).toBe("object 파일마다")
  const loop = fixture("for")
  expect(flowStatement(loop.map, catalog, loop.map.tasks.find((t) => t.id === loop.id)!)).toBe("1부터 3까지 1씩")
  const branch = fixture("if")
  const withCondition = { ...branch.map, tasks: branch.map.tasks.map((t) => t.id === branch.id ? { ...t, draft: { ...t.draft, flow: { condition: "fwhm > 4.0" } } } : t) }
  expect(flowStatement(withCondition, catalog, withCondition.tasks.find((t) => t.id === branch.id)!)).toBe("fwhm > 4.0")
  // An if: two lanes, a diamond on the heading for each name its condition reads.
  const { ports, lane } = flowPorts(withCondition, catalog, withCondition.subflows![0])
  expect(ports.map((p) => p.handleId)).toEqual(["input", "p:fwhm", "output:then", "output:else", "result", "output:results"])
  expect(ports.find((p) => p.handleId === "p:fwhm")!.y).toBeLessThan(FLOW_HEADER)
  expect(ports.find((p) => p.handleId === "output:else")!.y).toBeGreaterThan(lane!)
})

test("inner ports reach members only; results and inputs stay outside", () => {
  const made = fixture()
  const id = made.id
  let map = made.map
  map = wire(map, "object", "output", id, "items")
  map = wire(map, id, "output:item", "proc", "images")
  expect(map.connections.find((c) => c.target === "proc")!.source).toMatchObject({ kind: "pending", taskId: id, outputRole: "item" })
  // Collecting a member's output is not a loop through the container.
  map = wire(map, "proc", "output", id, "result")
  map = wire(map, id, "output:results", "combine", "images")
  expect(map.connections.map((c) => [c.target, c.role]).filter(([t]) => t === id)).toEqual([[id, "items"], [id, "result"]])
  const feedback = (source: string, sourceHandle: string, target: string, targetHandle: string) =>
    connectionFeedback(map, catalog, [], { source, sourceHandle, target, targetHandle })
  expect(feedback(id, "output:item", "combine", "images")).toMatchObject({ valid: false, message: "안쪽 연결점은 이 안의 작업에만 연결합니다." })
  expect(feedback("object", "output", id, "result").valid).toBe(false)
  expect(feedback("proc", "output", id, "items").valid).toBe(false)
  expect(feedback(id, "output:results", "proc", "images").valid).toBe(false)
  // What uses the results cannot feed the list.
  expect(feedback("combine", "output", id, "items")).toMatchObject({ valid: false })
  // Inner edges start at the container's own handles.
  const edges = flowEdges(map, catalog)
  expect(edges.find((e) => e.target === "proc")).toMatchObject({ source: id, sourceHandle: "output:item", targetHandle: "images" })
  expect(edges.find((e) => e.target === "combine")).toMatchObject({ source: id, sourceHandle: "output:results" })
})

test("a for variable is a value port for member parameters", () => {
  const made = fixture("for")
  const id = made.id
  let map = made.map
  map = { ...map, tasks: map.tasks.map((t) => t.id === "proc" ? { ...t, pinned: ["aperture"] } : t) }
  map = wire(map, id, "value:숫자", "proc", "p:aperture")
  expect(map.connections.find((c) => c.role === "p:aperture")!.source).toMatchObject({ taskId: id, outputRole: "value:숫자" })
  expect(connectionFeedback(map, catalog, [], { source: id, sourceHandle: "value:숫자", target: "combine", targetHandle: "p:aperture" }).valid).toBe(false)
  const request = workflowRequest(map, catalog, "/work")
  expect(request.flows).toEqual([{ id, label: "for", run: "for", members: ["proc"], variable: "숫자", files: [], start: 1, end: 3, step: 1, condition: "" }])
  expect(request.values.nodes).toContainEqual(expect.objectContaining({ id, run: "value-constant", rows: [{ name: "숫자", value: "1" }] }))
  expect(request.values.links).toContainEqual(expect.objectContaining({ target: "proc", parameter: "aperture", type: "r", source: { node: id, output: "숫자" } }))
})

test("runs send the container with its links; members keep their payloads", () => {
  const made = fixture()
  const id = made.id
  let map = made.map
  map = wire(map, "object", "output", id, "items")
  map = wire(map, id, "output:item", "proc", "images")
  map = wire(map, "proc", "output", id, "result")
  map = wire(map, id, "output:results", "combine", "images")
  const request = workflowRequest(map, catalog, "/work")
  expect(request.nodes.map((n) => n.id)).toEqual(["object", "proc", "combine"])
  expect(request.flows).toEqual([expect.objectContaining({ id, run: "foreach", members: ["proc"], variable: "파일", files: [] })])
  expect(request.links.map((l) => [l.source, l.target, l.role, l.sourceRole])).toEqual([
    ["object", id, "items", "output"], [id, "proc", "images", "item"], ["proc", id, "result", "output"], [id, "combine", "images", "results"],
  ])
  expect(request.nodes.find((n) => n.id === "proc")!.payload.inputs.images).toEqual([])
  // Diagnostics see the container's settings and its inner links as pending inputs.
  const checked = workflowDiagnosticRequest(map, catalog, "/work")
  expect(checked.flows[0]).toMatchObject({ id, connected: true })
  expect(checked.connections.some((c) => c.target === "proc")).toBe(true)
  // Running the container alone resolves an outside list to files.
  const done = { ...map, runs: [{ id: "r1", instanceId: "object", state: "completed", products: [{ id: "f1", label: "a.fits", role: "output" }, { id: "f2", label: "b.fits", role: "output" }] }] }
  const alone = subflowRequest(done, catalog, "/work", id)
  expect(alone.flows[0].files).toEqual(["f1", "f2"])
  // A member run on its own takes the first item.
  expect(syncContainerItems(done, catalog, []).tasks.find((t) => t.id === id)!.passed).toEqual({ item: ["f1"] })
})

test("member output names preview the first iteration's variable", () => {
  const made = fixture()
  const id = made.id
  let map = wire(made.map, "object", "output", id, "items")
  map = wire(map, id, "output:item", "proc", "images")
  map = { ...map, runs: [{ id: "r1", instanceId: "object", state: "completed", products: [{ id: "f1", label: "a.fits", role: "output" }, { id: "f2", label: "b.fits", role: "output" }] }] }
  map = syncContainerItems(map, catalog, [])
  const proc = map.tasks.find((t) => t.id === "proc")!
  const loop = loopVariable(map, catalog, proc, [])
  expect(loop).toEqual({ variable: "파일", value: "a" })
  const dump: Spec = { ...task("dump"), outputs: [{ name: "$stdout", kind: "text", default: "dump.txt", mode: "single" }] }
  const draft = { ...proc.draft, outputs: { $stdout: "M67{파일}{other}.dat" } }
  expect(plannedOutputs(dump, loopOutputNames(draft, loop), [])).toEqual([{ input: "dump", output: "M67a{other}.dat" }])
  expect(loopVariable(map, catalog, map.tasks.find((t) => t.id === "combine")!, [])).toBeUndefined()
  const counted = fixture("for")
  expect(loopVariable(counted.map, catalog, counted.map.tasks.find((t) => t.id === "proc")!, [])).toEqual({ variable: "숫자", value: "1" })
})

test("a container names its own variable; older names follow it", () => {
  const made = fixture()
  const id = made.id
  let map = wire(made.map, "object", "output", id, "items")
  // A document from before: the variable typed as image, used in a member's output name.
  map = {
    ...map,
    tasks: map.tasks.map((t) =>
      t.id === id ? { ...t, draft: { ...t.draft, flow: { variable: "image" } } }
      : t.id === "proc" ? { ...t, draft: { ...t.draft, outputs: { $stdout: "M67{image}.dat" } } } : t),
  }
  map = syncContainerItems(map, catalog, [])
  expect(map.tasks.find((t) => t.id === id)!.draft.flow).toEqual({ variable: "파일" })
  expect(map.tasks.find((t) => t.id === "proc")!.draft.outputs).toEqual({ $stdout: "M67{파일}.dat" })
  expect(containerLabel(map, catalog, map.tasks.find((t) => t.id === id)!)).toBe("foreach")
})

test("collapsed, a container keeps its ports and hides inner edges", () => {
  const made = fixture()
  const id = made.id
  let map = made.map
  map = wire(map, "object", "output", id, "items")
  map = wire(map, id, "output:item", "proc", "images")
  map = wire(map, "proc", "output", id, "result")
  map = wire(map, id, "output:results", "combine", "images")
  const collapsed = setSubflowCollapsed(map, id, true)
  const node = flowNodes(collapsed, catalog).find((n) => n.id === id)!
  expect(node.type).toBe("compound")
  expect(node.handles!.map((h) => h.id)).toEqual(["items", "output:results"])
  const ports = compoundPorts(collapsed, collapsed.subflows![0], taskEdges(collapsed, catalog))
  expect(ports.inputs).toEqual([])
  const edges = flowEdges(collapsed, catalog)
  expect(edges.filter((e) => e.hidden).map((e) => e.target).sort()).toEqual([id, "proc"].sort())
  expect(edges.find((e) => e.target === "combine")).toMatchObject({ source: id, sourceHandle: "output:results" })
  expect(edges.find((e) => e.target === "combine")!.hidden).toBeFalsy()
})

test("removing a container keeps its members; undo brings both back", () => {
  const { map, id } = fixture()
  const removed = removeTask(map, id)
  expect(removed.subflows).toEqual([])
  expect(removed.tasks.find((t) => t.id === "proc")!.subflowId).toBeUndefined()
  const restored = restoreTask(removed, map, id)
  expect(restored.subflows!.map((g) => g.id)).toEqual([id])
  expect(restored.tasks.find((t) => t.id === "proc")!.subflowId).toBe(id)
})

test("settings survive saving; auto layout places the container as its group", async () => {
  const { map, id } = fixture("for")
  const saved = JSON.parse(JSON.stringify(map))
  const loaded = migrateMap({ ...prefs, taskMap: saved }, catalog)
  expect(loaded.tasks.find((t) => t.id === id)!.draft.flow).toEqual({ variable: "숫자", start: "1", end: "3", step: "1" })
  const laid = await autoLayoutMap(loaded, catalog)
  const group = laid.subflows!.find((g) => g.id === id)!
  expect(laid.tasks.find((t) => t.id === id)!.position).toEqual(group.position)
})

test("a container is named and colored like a group; one name for canvas and inspector", () => {
  const { map, id } = fixture()
  const edited = updateSubflow(map, id, { name: "필터별 측광", color: "rose" })
  const task = edited.tasks.find((t) => t.id === id)!
  expect(task.label).toBe("필터별 측광")
  expect(containerLabel(edited, catalog, task)).toBe("필터별 측광")
  expect(edited.subflows!.find((g) => g.id === id)!.color).toBe("rose")
  // Renaming in the inspector edits the label alone; the canvas follows.
  const renamed = { ...edited, tasks: edited.tasks.map((t) => (t.id === id ? { ...t, label: "다시" } : t)) }
  expect(containerLabel(renamed, catalog, renamed.tasks.find((t) => t.id === id)!)).toBe("다시")
})

test("dissolving a container removes it and keeps its members", () => {
  const { map, id } = fixture()
  const dissolved = dissolveSubflow(map, id)
  expect(dissolved.tasks.some((t) => t.id === id)).toBe(false)
  expect(dissolved.subflows!.some((g) => g.id === id)).toBe(false)
  expect(dissolved.tasks.find((t) => t.id === "proc")!.subflowId).toBeUndefined()
})

test("a duplicated container brings copies of its members and their links", () => {
  const made = fixture()
  const id = made.id
  let map = wire(made.map, "object", "output", id, "items")
  map = wire(map, id, "output:item", "proc", "images")
  map = wire(map, "proc", "output", id, "result")
  const copy = duplicateTask(map, id, { x: 1000, y: 40 })
  const newId = copy.view.selected
  expect(newId).not.toBe(id)
  expect(copy.subflows!.find((g) => g.id === newId)!.position).toEqual({ x: 1000, y: 40 })
  const members = copy.tasks.filter((t) => t.subflowId === newId)
  expect(members).toHaveLength(1)
  const member = members[0]
  expect(member.id).not.toBe("proc")
  expect(member.position).toEqual({ x: 1080, y: 140 })
  // Outside input, inner item and collected result all point at the copies.
  expect(copy.connections.find((c) => c.target === newId && c.role === "items")!.source).toMatchObject({ taskId: "object" })
  expect(copy.connections.find((c) => c.target === member.id)!.source).toMatchObject({ kind: "pending", taskId: newId, outputRole: "item" })
  expect(copy.connections.find((c) => c.target === newId && c.role === "result")!.source).toMatchObject({ kind: "pending", taskId: member.id })
  // The original keeps its member.
  expect(copy.tasks.find((t) => t.id === "proc")!.subflowId).toBe(id)
})
