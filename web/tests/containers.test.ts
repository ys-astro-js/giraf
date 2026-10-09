import { beforeAll, expect, test } from "bun:test"
import { emptyMap, makeInstance, addTask, connect, removeTask, duplicateTask, restoreTask, workflowRequest, workflowDiagnosticRequest, migrateMap, payloadFor } from "../src/lib/task-map"
import { setSubflowCollapsed, autoLayoutMap, moveTaskToSubflow, saveSubflow, updateSubflow, dissolveSubflow } from "../src/lib/subflow"
import {
  addContainer, containerLabel, flowPorts, flowProgress, flowStatement, setGroupRun, syncContainerItems, loopOutputNames,
  loopVariables, memberPassInputs, loopIssues, receiveMode, regionRounds, roundsOf, setReceiveMode, type Criterion,
} from "../src/lib/containers"
import { flowNodes, flowEdges, connectFlow, connectionFeedback } from "../src/lib/workflow-flow"
import { valueRequest } from "../src/lib/values"
import { nodeLayout } from "../src/lib/node-interaction"
import { plannedOutputs, type Catalog, type Frame, type Preferences, type Spec } from "../src/lib/workbench"
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
  inputs: [
    { name: "images", label: "영상", kind: "image", multiple: true },
    { name: "dark", label: "dark", kind: "image", multiple: true },
    { name: "flat", label: "flat", kind: "image", multiple: true },
  ],
  outputs: [{ name: "output", kind: "image", default: "p_", mode: "each" }],
  output: null,
  kind: "image",
})
const region: Spec = {
  name: "giraf.foreach",
  title: "반복",
  taskName: "반복",
  package: "giraf",
  adapter: "generic",
  run: "foreach",
  parameters: [],
  inputs: [],
  outputs: [],
  output: null,
  kind: "any",
}
const catalog: Catalog = {
  version: "test",
  tasks: [task("ccdproc2"), region],
  ccdproc: { parameters: [], inputs: [] },
  ccdred: [],
  exam: {},
}
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const spec = (name: string) => catalog.tasks.find((s) => s.name === name)!
const frame = (id: string, headers: Record<string, string> = {}, extra: Partial<Frame> = {}): Frame =>
  ({ id, label: id + ".fits", asset: "image", role: "output", headers, ...extra })
const ran = (map: TaskMap, id: string, products: Frame[]): TaskMap =>
  ({ ...map, runs: [...map.runs, { id: "run-" + id, instanceId: id, state: "completed", products }] })
const setFlow = (map: TaskMap, id: string, flow: { criteria?: Criterion[]; split?: { taskId: string; outputRole?: string }; condition?: string }) =>
  ({ ...map, tasks: map.tasks.map((t) => (t.id === id ? { ...t, draft: { ...t.draft, flow } } : t)) })

/** object → [region: proc] → combine; the region's id is its group's. */
function fixture() {
  let map = ["object", "proc", "combine"].reduce(
    (m, id, i) => addTask(m, { ...makeInstance(spec("ccdproc2"), catalog, prefs, id), label: id, position: { x: i * 800, y: 100 } }),
    emptyMap()
  )
  map = addContainer(map, catalog, region, prefs, nodeLayout(map, catalog))
  const id = map.subflows![0].id
  map = { ...map, subflows: map.subflows!.map((g) => ({ ...g, position: { x: 360, y: 40 }, width: 400, height: 280 })) }
  map = moveTaskToSubflow(map, catalog, "proc", id, { x: 440, y: 140 })
  return { map, id }
}
const wire = (map: TaskMap, source: string, sourceHandle: string, target: string, targetHandle: string) =>
  connectFlow(map, catalog, [], { source, sourceHandle, target, targetHandle })

test("a region is a task and a group with one id, drawn as the group without boundary ports", () => {
  const { map, id } = fixture()
  expect(map.tasks.find((t) => t.id === id)!.draft.flow).toEqual({ criteria: [] })
  const nodes = flowNodes(map, catalog)
  expect(nodes.filter((n) => n.id === id).map((n) => n.type)).toEqual(["subflow"])
  const group = nodes.find((n) => n.id === id)!
  expect(group.handles).toEqual([])
  expect(nodeLayout(map, catalog).find((n) => n.id === id)).toMatchObject({ width: 0, height: 0 })
  // Each criterion's label is a value output inside the region.
  const keyed = setFlow(map, id, { criteria: [{ keyword: "EXPTIME" }, { count: 5, order: "name" }], split: { taskId: "object" } })
  expect(flowPorts(keyed, catalog, keyed.subflows![0]).ports.map((p) => [p.handleId, p.type])).toEqual([
    ["value:EXPTIME", "source"], ["value:묶음", "source"],
  ])
})

test("the heading says what it repeats by", () => {
  const { map, id } = fixture()
  const say = (flow: Parameters<typeof setFlow>[2]) => {
    const next = setFlow(map, id, flow)
    return flowStatement(next, catalog, next.tasks.find((t) => t.id === id)!)
  }
  expect(say({ criteria: [] })).toBe("무엇마다 반복할지 정해 주세요")
  expect(say({ criteria: [{ keyword: "FILTER" }, { keyword: "EXPTIME" }] })).toBe("FILTER, EXPTIME마다")
  expect(say({ criteria: [{ keyword: "EXPTIME" }, { count: 5, order: "name" }] })).toBe("EXPTIME마다 5장씩")
  expect(say({ criteria: [{ each: true }] })).toBe("파일마다")
  expect(say({ criteria: [{ times: 3 }] })).toBe("3번")
  expect(say({ criteria: [], condition: "EXPTIME > 30" })).toBe("EXPTIME > 30")
})

test("connections go straight to inner tasks; a region has nothing to connect to", () => {
  const made = fixture()
  const id = made.id
  let map = wire(made.map, "object", "output", "proc", "images")
  map = wire(map, "proc", "output", "combine", "images")
  expect(map.connections.map((c) => [c.source.kind !== "files" && c.source.taskId, c.target])).toEqual([["object", "proc"], ["proc", "combine"]])
  expect(connectionFeedback(map, catalog, [], { source: "object", sourceHandle: "output", target: id, targetHandle: "items" }).valid).toBe(false)
  // A region's round value reaches tasks inside it only.
  map = setFlow(map, id, { criteria: [{ times: 3 }] })
  map = { ...map, tasks: map.tasks.map((t) => (t.id === "proc" || t.id === "combine" ? { ...t, pinned: ["aperture"] } : t)) }
  map = wire(map, id, "value:회차", "proc", "p:aperture")
  expect(map.connections.at(-1)!.source).toMatchObject({ taskId: id, outputRole: "value:회차" })
  expect(connectionFeedback(map, catalog, [], { source: id, sourceHandle: "value:회차", target: "combine", targetHandle: "p:aperture" }))
    .toMatchObject({ valid: false, message: "회차 값은 이 영역 안의 작업에만 연결합니다." })
  // Edges stay between the tasks.
  expect(flowEdges(map, catalog).find((e) => e.target === "proc" && e.targetHandle === "images")).toMatchObject({ source: "object" })
})

test("rounds divide by keywords, chunks, files and times, sorted naturally", () => {
  const frames = new Map([
    frame("b30a", { FILTER: "B", EXPTIME: "30" }), frame("v15a", { FILTER: "V", EXPTIME: "15" }),
    frame("b30b", { FILTER: "B", EXPTIME: "30.0" }), frame("v15b", { FILTER: "V", EXPTIME: "15" }), frame("v30", { FILTER: "V", EXPTIME: "30" }),
  ].map((f) => [f.id, f]))
  const ids = [...frames.keys()]
  const names = (criteria: Criterion[]) => roundsOf(ids, frames, { criteria })!.map((r) => [r.name, r.ids])
  expect(names([{ keyword: "FILTER" }, { keyword: "EXPTIME" }])).toEqual([
    ["B 30", ["b30a", "b30b"]], ["V 15", ["v15a", "v15b"]], ["V 30", ["v30"]],
  ])
  expect(names([{ count: 2, order: "name" }])).toEqual([["1", ["b30a", "b30b"]], ["2", ["v15a", "v15b"]], ["3", ["v30"]]])
  expect(names([{ each: true }])[0]).toEqual(["b30a", ["b30a"]])
  expect(roundsOf([], frames, { criteria: [{ times: 2 }] })!.map((r) => r.values)).toEqual([{ 회차: "1" }, { 회차: "2" }])
  // Expressions and conditions are evaluated by the run.
  expect(roundsOf(ids, frames, { criteria: [], condition: "EXPTIME > 20" })).toBeUndefined()
})

/** Darks by EXPTIME with chunks of five inside; science by FILTER, EXPTIME. */
function reduction() {
  let map = ["darks", "median", "average", "science", "mflat", "ccdproc"].reduce(
    (m, id, i) => addTask(m, { ...makeInstance(spec("ccdproc2"), catalog, prefs, id), label: id, position: { x: i * 400, y: 100 } }),
    emptyMap()
  )
  // Groups drawn by hand: the inner region sits in the outer one, as nested loops.
  const group = (m: TaskMap, id: string, name: string, members: string[], parent?: string): TaskMap => {
    const made = setGroupRun({ ...m, subflows: [...(m.subflows ?? []), { id, name, position: { x: 0, y: 0 }, width: 400, height: 240 }] }, catalog, prefs, id, "foreach")
    return { ...made, tasks: made.tasks.map((t) => (members.includes(t.id) ? { ...t, subflowId: id } : t.id === id && parent ? { ...t, subflowId: parent } : t)) }
  }
  map = group(map, "exp", "다크", ["average"])
  map = group(map, "chunk", "5장씩", ["median"], "exp")
  map = group(map, "proc", "과학", ["ccdproc"])
  map = setFlow(map, "exp", { criteria: [{ keyword: "EXPTIME" }], split: { taskId: "darks" } })
  map = setFlow(map, "chunk", { criteria: [{ count: 5, order: "name" }], split: { taskId: "darks" } })
  map = setFlow(map, "proc", { criteria: [{ keyword: "FILTER" }, { keyword: "EXPTIME" }], split: { taskId: "science" } })
  map = connect(map, "median", "images", { kind: "pending", taskId: "darks" })
  map = connect(map, "average", "images", { kind: "pending", taskId: "median" })
  map = connect(map, "ccdproc", "images", { kind: "pending", taskId: "science" })
  map = connect(map, "ccdproc", "dark", { kind: "pending", taskId: "average" })
  map = connect(map, "ccdproc", "flat", { kind: "pending", taskId: "mflat" })
  const flat = map.connections.find((c) => c.role === "flat")!
  map = setReceiveMode(map, flat.id, "proc", { mode: "match", keys: ["FILTER"] })
  const darks = Array.from({ length: 7 }, (_, n) => frame(`d15_${n + 1}`, { EXPTIME: "15" }))
    .concat(Array.from({ length: 3 }, (_, n) => frame(`d30_${n + 1}`, { EXPTIME: "30" })))
  map = ran(map, "darks", darks)
  map = ran(map, "science", [frame("b30", { FILTER: "B", EXPTIME: "30" }), frame("v15", { FILTER: "V", EXPTIME: "15" })])
  map = ran(map, "mflat", [frame("FlatB", { FILTER: "B" }), frame("FlatV", { FILTER: "V" })])
  return map
}

test("connections crossing a region receive by its split, by labels or for every round", () => {
  const map = reduction()
  const ccd = map.tasks.find((t) => t.id === "proc")!
  const into = (role: string) => map.connections.find((c) => c.target === "ccdproc" && c.role === role)!
  expect(receiveMode(map, into("images"), ccd)).toEqual({ mode: "split" })
  // The master dark is made inside the EXPTIME region: it pairs by its label.
  expect(receiveMode(map, into("dark"), ccd)).toEqual({ mode: "match", keys: ["EXPTIME"] })
  // The flat file node has no labels; the stored mode pairs it by its FILTER header.
  expect(receiveMode(map, into("flat"), ccd)).toEqual({ mode: "match", keys: ["FILTER"] })
  expect(regionRounds(map, ccd, []).rounds!.map((r) => r.name)).toEqual(["B 30", "V 15"])
  // Nested: the chunks of the first EXPTIME round.
  const chunk = map.tasks.find((t) => t.id === "chunk")!
  expect(regionRounds(map, chunk, []).rounds!.map((r) => r.ids)).toEqual([
    ["d15_1", "d15_2", "d15_3", "d15_4", "d15_5"], ["d15_6", "d15_7"],
  ])
  const inputs = memberPassInputs(map, catalog, map.tasks.find((t) => t.id === "ccdproc")!, [])!
  expect(inputs.flat).toEqual({ kind: "passes", passes: [{ name: "B 30", ids: ["FlatB"] }, { name: "V 15", ids: ["FlatV"] }], missing: [] })
  // The master dark is made round by round: known once it runs.
  expect(inputs.dark).toEqual({ kind: "unknown" })
})

test("a member run alone takes the first rounds; output names read their labels", () => {
  let map = syncContainerItems(reduction(), catalog, [])
  const median = map.tasks.find((t) => t.id === "median")!
  expect(median.roundValues).toEqual({ EXPTIME: "15", 묶음: "1" })
  expect(payloadFor(map, "median", catalog).inputs.images).toEqual(["d15_1", "d15_2", "d15_3", "d15_4", "d15_5"])
  const flat = map.connections.find((c) => c.role === "flat")!
  expect(map.tasks.find((t) => t.id === "ccdproc")!.firstRound).toEqual({ [flat.id]: ["FlatB"], [map.connections.find((c) => c.target === "ccdproc" && c.role === "images")!.id]: ["b30"] })
  const loop = loopVariables(map, catalog, median, [])
  expect(loop).toEqual([{ variable: "EXPTIME", value: "15" }, { variable: "묶음", value: "1" }])
  const dump: Spec = { ...task("dump"), outputs: [{ name: "$stdout", kind: "text", default: "dump.txt", mode: "single" }] }
  const draft = { ...median.draft, outputs: { $stdout: "Dark{EXPTIME}_{묶음}{other}.fits" } }
  expect(plannedOutputs(dump, loopOutputNames(draft, loop), [])).toEqual([{ input: "dump", output: "Dark15_1{other}.fits" }])
  // A round with no matching flat is a warning.
  map = ran(map, "mflat", [frame("FlatB", { FILTER: "B" })])
  expect(loopIssues(map, catalog, []).map((i) => i.message)).toEqual(["V 15 회차에 맞는 flat가 없습니다."])
})

test("runs send each region with its criteria, split and members; crossing links carry their modes", () => {
  const map = reduction()
  const request = workflowRequest(map, catalog, "/work")
  expect(request.flows).toEqual([
    { id: "exp", label: "다크", members: ["average", "chunk"], criteria: [{ keyword: "EXPTIME" }], split: { taskId: "darks" }, condition: "" },
    { id: "chunk", label: "5장씩", members: ["median"], criteria: [{ count: 5, order: "name" }], split: { taskId: "darks" }, condition: "" },
    { id: "proc", label: "과학", members: ["ccdproc"], criteria: [{ keyword: "FILTER" }, { keyword: "EXPTIME" }], split: { taskId: "science" }, condition: "" },
  ])
  expect(request.links.find((l) => l.role === "flat")).toMatchObject({ source: "mflat", target: "ccdproc", flow: { proc: { mode: "match", keys: ["FILTER"] } } })
  expect(request.links.find((l) => l.role === "dark")).toMatchObject({ source: "average", target: "ccdproc" })
  expect(request.nodes.find((n) => n.id === "ccdproc")!.payload.inputs.images).toEqual([])
  // Diagnostics get the regions and every connection with its modes.
  const checked = workflowDiagnosticRequest(map, catalog, "/work")
  expect(checked.flows.map((f) => f.id)).toEqual(["exp", "chunk", "proc"])
  expect(checked.connections.find((c) => c.role === "flat")!.flow).toEqual({ proc: { mode: "match", keys: ["FILTER"] } })
})

test("a split source outside the run goes with the region as files", () => {
  const map = reduction()
  const only = { ...map, tasks: map.tasks.filter((t) => !["darks", "science", "mflat"].includes(t.id)) }
  const request = workflowRequest(only, catalog, "/work", map)
  expect(request.flows.find((f) => f.id === "proc")!.splitFiles).toEqual(["b30", "v15"])
  expect(request.links.find((l) => l.role === "flat")).toMatchObject({ source: "mflat", files: ["FlatB", "FlatV"] })
  expect(request.links.find((l) => l.role === "images" && l.target === "ccdproc")).toMatchObject({ source: "science", files: ["b30", "v15"] })
})

test("a region's value is its first round's when a member runs alone, and each round's in a run", () => {
  let map = reduction()
  map = { ...map, tasks: map.tasks.map((t) => (t.id === "median" ? { ...t, pinned: ["aperture"] } : t)) }
  map = wire(map, "exp", "value:EXPTIME", "median", "p:aperture")
  map = syncContainerItems(map, catalog, [])
  const alone = valueRequest(map, catalog)
  expect(alone.nodes).toContainEqual(expect.objectContaining({ id: "exp", run: "value-constant", rows: [{ name: "EXPTIME", value: "15" }] }))
  expect(alone.links).toContainEqual(expect.objectContaining({ target: "median", parameter: "aperture", source: { node: "exp", output: "EXPTIME" } }))
  // In a run the server gives each round its own; the request carries no first round.
  const run = workflowRequest(map, catalog, "/work")
  expect(run.values.links.find((l) => l.target === "median")).not.toHaveProperty("round")
})

test("older documents open as regions", () => {
  let map = ["object", "proc", "combine", "flats"].reduce(
    (m, id, i) => addTask(m, { ...makeInstance(spec("ccdproc2"), catalog, prefs, id), label: id, position: { x: i * 400, y: 100 } }),
    emptyMap()
  )
  const old = (id: string, taskName: string, flow: Record<string, unknown>, members: string[]): TaskMap => ({
    ...map,
    subflows: [...(map.subflows ?? []), { id, name: id, position: { x: 0, y: 0 }, width: 400, height: 240 }],
    tasks: [...map.tasks.map((t) => (members.includes(t.id) ? { ...t, subflowId: id } : t)),
      { ...makeInstance(region, catalog, prefs, id), task: taskName, draft: { ...makeInstance(region, catalog, prefs, id).draft, flow: flow as never } }],
  })
  const c = (id: string, source: string, outputRole: string | undefined, target: string, role: string, extra: object = {}) =>
    ({ id, target, role, source: { kind: "pending" as const, taskId: source, ...(outputRole ? { outputRole } : {}), ...extra } })
  // 각각 반복 by SUBSET: list from object and flats, item to proc, results to combine.
  map = old("loop", "giraf.foreach", { variable: "SUBSET", keywords: ["SUBSET"] }, ["proc"])
  map = { ...map, connections: [
    c("a", "object", "image", "loop", "items"), c("b", "flats", undefined, "loop", "items"),
    c("c", "loop", "item", "proc", "images"), c("d", "proc", "output", "loop", "result"), c("e", "loop", "results", "combine", "images"),
    c("f", "flats", "image", "combine", "flat", { partition: { keyword: "SUBSET", value: "B" }, group: { filter: "B" } }),
  ] }
  map.tasks = map.tasks.map((t) => (t.id === "proc" ? { ...t, draft: { ...t.draft, outputs: { output: "p{SUBSET}" } } } : t))
  const loaded = migrateMap({ ...prefs, taskMap: JSON.parse(JSON.stringify(map)) }, catalog)
  expect(loaded.tasks.find((t) => t.id === "loop")!.draft.flow).toEqual({ criteria: [{ keyword: "SUBSET" }], split: { taskId: "object", outputRole: "image" } })
  expect(loaded.connections.map((x) => [x.source.kind !== "files" && x.source.taskId, x.target, x.role, x.flow])).toEqual([
    ["object", "proc", "images", undefined],
    ["flats", "proc", "images", { loop: { mode: "match", keys: ["SUBSET"] } }],
    ["proc", "combine", "images", undefined],
    ["flats", "combine", "flat", undefined],
  ])
  expect(loaded.connections.at(-1)!.source).toEqual({ kind: "pending", taskId: "flats", outputRole: "image" })
  // 반복 by numbers: N번, its number is 회차.
  map = old("range", "giraf.for", { variable: "숫자", start: "2", end: "10", step: "2" }, ["proc"])
  map = { ...map, connections: [c("v", "range", "value:숫자", "proc", "p:aperture")] }
  map.tasks = map.tasks.map((t) => (t.id === "proc" ? { ...t, draft: { ...t.draft, outputs: { output: "ap{숫자}" } } } : t))
  const counted = migrateMap({ ...prefs, taskMap: map }, catalog)
  expect(counted.tasks.find((t) => t.id === "range")).toMatchObject({ task: "giraf.foreach", draft: { flow: { criteria: [{ times: 5 }] } } })
  expect(counted.connections[0].source).toMatchObject({ taskId: "range", outputRole: "value:회차" })
  expect(counted.tasks.find((t) => t.id === "proc")!.draft.outputs).toEqual({ output: "ap{회차}" })
  // 조건 분기: 참 stays with the condition, 거짓 goes to a region with the opposite one.
  map = old("branch", "giraf.if", { condition: "EXPTIME > 30" }, ["proc", "combine"])
  map = { ...map, connections: [
    c("i", "object", undefined, "branch", "input"), c("t", "branch", "then", "proc", "images"), c("e", "branch", "else", "combine", "images"),
  ] }
  const branched = migrateMap({ ...prefs, taskMap: map }, catalog)
  const opposite = branched.tasks.find((t) => t.id === branched.tasks.find((x) => x.id === "combine")!.subflowId)!
  expect(branched.tasks.find((t) => t.id === "branch")!.draft.flow).toEqual({ criteria: [], split: { taskId: "object" }, condition: "EXPTIME > 30" })
  expect(opposite.draft.flow).toEqual({ criteria: [], split: { taskId: "object" }, condition: "!(EXPTIME > 30)" })
  expect(branched.subflows!.map((g) => g.id)).toContain(opposite.id)
  expect(branched.connections.map((x) => [x.source.kind !== "files" && x.source.taskId, x.target])).toEqual([["object", "proc"], ["object", "combine"]])
})

test("collapsed, a region's rows are the connections crossing it", () => {
  const made = fixture()
  const id = made.id
  let map = wire(made.map, "object", "output", "proc", "images")
  map = wire(map, "proc", "output", "combine", "images")
  const collapsed = setSubflowCollapsed(map, id, true)
  const node = flowNodes(collapsed, catalog).find((n) => n.id === id)!
  expect(node.type).toBe("compound")
  expect(node.handles!.map((h) => h.id)).toEqual(["in:proc:images", "out:proc:output"])
})

test("removing a region keeps its members; undo brings both back", () => {
  const { map, id } = fixture()
  const removed = removeTask(map, id)
  expect(removed.subflows).toEqual([])
  expect(removed.tasks.find((t) => t.id === "proc")!.subflowId).toBeUndefined()
  const restored = restoreTask(removed, map, id)
  expect(restored.subflows!.map((g) => g.id)).toEqual([id])
  expect(restored.tasks.find((t) => t.id === "proc")!.subflowId).toBe(id)
})

test("settings survive saving; auto layout places the region as its group", async () => {
  const made = fixture()
  const map = setFlow(made.map, made.id, { criteria: [{ times: 3 }] })
  const loaded = migrateMap({ ...prefs, taskMap: JSON.parse(JSON.stringify(map)) }, catalog)
  expect(loaded.tasks.find((t) => t.id === made.id)!.draft.flow).toEqual({ criteria: [{ times: 3 }] })
  const laid = await autoLayoutMap(loaded, catalog)
  const group = laid.subflows!.find((g) => g.id === made.id)!
  expect(laid.tasks.find((t) => t.id === made.id)!.position).toEqual(group.position)
})

test("a region is named and colored like a group; one name for canvas and inspector", () => {
  const { map, id } = fixture()
  const edited = updateSubflow(map, id, { name: "필터별 측광", color: "rose" })
  const task = edited.tasks.find((t) => t.id === id)!
  expect(containerLabel(edited, catalog, task)).toBe("필터별 측광")
  expect(edited.subflows!.find((g) => g.id === id)!.color).toBe("rose")
})

test("dissolving a region removes it and keeps its members", () => {
  const { map, id } = fixture()
  const dissolved = dissolveSubflow(map, id)
  expect(dissolved.tasks.some((t) => t.id === id)).toBe(false)
  expect(dissolved.tasks.find((t) => t.id === "proc")!.subflowId).toBeUndefined()
})

test("a duplicated region brings copies of its members, links and receive modes", () => {
  const made = fixture()
  const id = made.id
  let map = wire(made.map, "object", "output", "proc", "images")
  map = setReceiveMode(map, map.connections[0].id, id, { mode: "all", keys: [] })
  const copy = duplicateTask(map, id, { x: 1000, y: 40 })
  const newId = copy.view.selected
  const member = copy.tasks.find((t) => t.subflowId === newId)!
  expect(member.position).toEqual({ x: 1080, y: 140 })
  expect(copy.connections.find((c) => c.target === member.id)).toMatchObject({ source: { taskId: "object" }, flow: { [newId]: { mode: "all", keys: [] } } })
})

test("progress reads as x/y and aloud as a sentence", () => {
  expect(flowProgress("foreach", { index: 2, total: 4 })).toEqual({ text: "2/4", label: "4회 중 2번째" })
  expect(flowProgress("foreach", undefined)).toBeUndefined()
})

test("a plain group becomes a region in place and back, keeping members and links", () => {
  let map = ["object", "a", "b"].reduce(
    (m, id, i) => addTask(m, { ...makeInstance(spec("ccdproc2"), catalog, prefs, id), label: id, position: { x: i * 400, y: 100 } }),
    emptyMap()
  )
  map = saveSubflow(map, catalog, { id: "g", name: "측광", taskIds: ["a", "b"] })
  map = connect(map, "a", "images", { kind: "pending", taskId: "object" })
  expect(setGroupRun(map, catalog, prefs, "g", undefined)).toBe(map)
  const looped = setGroupRun(map, catalog, prefs, "g", "foreach")
  const task = looped.tasks.find((t) => t.id === "g")!
  expect(task).toMatchObject({ task: "giraf.foreach", label: "측광" })
  expect(task.draft.flow).toEqual({ criteria: [] })
  expect(looped.connections).toEqual(map.connections)
  const once = setGroupRun(looped, catalog, prefs, "g", undefined)
  expect(once.tasks.some((t) => t.id === "g")).toBe(false)
  expect(once.connections).toEqual(map.connections)
})
