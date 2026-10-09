import { expect, test } from "bun:test"
import type { Catalog, Frame, Preferences, Spec } from "../src/lib/workbench"
import { addTask, connect, emptyMap, makeInstance, migrateMap, payloadFor, workflowDiagnosticRequest, workflowRequest, type TaskMap } from "../src/lib/task-map"
import { subflowRequest, moveTaskToSubflow } from "../src/lib/subflow"
import {
  addContainer,
  flowFiles,
  flowKeywordChoices,
  flowPasses,
  flowStatement,
  groupPasses,
  loopIssues,
  loopOutputNames,
  loopVariables,
  matchPass,
  memberPassInputs,
  memberVariables,
  syncContainerItems,
} from "../src/lib/containers"
import { syncPassOutputs } from "../src/lib/output-ports"
import { connectFlow } from "../src/lib/workflow-flow"
import { nodeLayout } from "../src/lib/node-interaction"

const source: Spec = {
  name: "giraf.file_input", taskName: "파일 입력", title: "파일 입력", package: "giraf", adapter: "generic",
  run: "pass-files", runnable: true, parameters: [], output: null, kind: "any",
  inputs: [{ name: "files", label: "파일", kind: "any", multiple: true, required: true, sources: ["files"] }],
  outputs: [
    { name: "image", kind: "image", mode: "pass", from: "files", optional: true, default: "" },
    { name: "text", kind: "text", mode: "pass", from: "files", optional: true, default: "" },
  ],
}
const single = (name: string, kind = "image") => ({ name, label: name, kind, multiple: false })
const proc: Spec = {
  name: "proc", title: "proc", package: "test", adapter: "generic", runnable: true, parameters: [], output: null, kind: "image",
  inputs: [{ name: "images", label: "images", kind: "image", multiple: true, required: true }, single("zero"), single("dark"),
    single("flat"), single("reference"), single("coords", "text")],
  outputs: [{ name: "output", kind: "image", default: "p_", mode: "each" }],
}
const foreach: Spec = {
  name: "giraf.foreach", title: "각각 반복", taskName: "각각 반복", package: "giraf", adapter: "generic", run: "foreach",
  parameters: [], output: null, kind: "any", outputs: [],
  inputs: [{ name: "items", label: "파일", kind: "any", multiple: true, required: true, sources: ["node"] }],
}
const catalog: Catalog = { version: "test", tasks: [source, proc, foreach], ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {} }
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }

const image = (id: string, headers: Record<string, string> = {}): Frame => ({ id, label: id + ".fits", asset: "image", headers })
const rows: Frame[] = [
  image("b30a", { SUBSET: "B", EXPTIME: "30", IMAGETYP: "object" }), image("v15a", { SUBSET: "V", EXPTIME: "15", IMAGETYP: "object" }),
  image("b30b", { SUBSET: "B", EXPTIME: "30", IMAGETYP: "object" }), image("v15b", { SUBSET: "V", EXPTIME: "15", IMAGETYP: "object" }),
  image("Zero", { IMAGETYP: "zero" }),
  image("FlatB", { SUBSET: "B" }), image("FlatV", { SUBSET: "V" }),
  image("Dark15", { EXPTIME: "15" }), image("Dark30", { EXPTIME: "30" }), image("Dark60", { EXPTIME: "60" }),
  image("pM67_B30_1", { SUBSET: "B", EXPTIME: "30" }),
  { id: "coo", label: "m67.coo", asset: "text" },
]
const files: Record<string, string[]> = {
  sci: ["b30a", "v15a", "b30b", "v15b"], bias: ["Zero"], flats: ["FlatB", "FlatV"], darks: ["Dark15", "Dark30"],
  ref: ["pM67_B30_1"], coords: ["coo"],
}

/** File nodes outside a 각각 반복 holding proc; the loop's list is the science files. */
function fixture(keywords: string[] = []) {
  let map = Object.keys(files).reduce((m, id, i) =>
    connect(addTask(m, { ...makeInstance(source, catalog, prefs, id), label: id, position: { x: 0, y: i * 120 } }), id, "files",
      { kind: "files", ids: files[id], label: "파일" }), emptyMap())
  map = addTask(map, { ...makeInstance(proc, catalog, prefs, "proc"), label: "proc", position: { x: 900, y: 100 } })
  map = addContainer(map, catalog, foreach, prefs, nodeLayout(map, catalog))
  const id = map.subflows![0].id
  map = { ...map, subflows: map.subflows!.map((g) => ({ ...g, position: { x: 600, y: 40 }, width: 400, height: 280 })) }
  map = moveTaskToSubflow(map, catalog, "proc", id, { x: 640, y: 140 })
  map = syncPassOutputs(map, catalog, rows)
  map = connectFlow(map, catalog, rows, { source: "sci", sourceHandle: "output", target: id, targetHandle: "items" })
  map = connectFlow(map, catalog, rows, { source: id, sourceHandle: "output:item", target: "proc", targetHandle: "images" })
  for (const [from, role, outputRole] of [["bias", "zero", "image"], ["flats", "flat", "image"], ["darks", "dark", "image"],
    ["ref", "reference", "image"], ["coords", "coords", "text"]])
    map = connect(map, "proc", role, { kind: "pending", taskId: from, outputRole })
  map = withKeywords(map, id, keywords)
  return { map, id }
}
const withKeywords = (map: TaskMap, id: string, keywords: string[]) => syncContainerItems(
  { ...map, tasks: map.tasks.map((t) => (t.id === id ? { ...t, draft: { ...t.draft, flow: { ...t.draft.flow, keywords } } } : t)) },
  catalog, rows)
const taskOf = (map: TaskMap, id: string) => map.tasks.find((t) => t.id === id)!

test("passes are the value combinations of the chosen keywords, sorted naturally", () => {
  const frames = new Map(rows.map((r) => [r.id, r]))
  const ids = ["b30a", "v15a", "b30b", "v15b", "Dark15"]
  expect(groupPasses(ids, frames, ["SUBSET", "EXPTIME"]).map((p) => [p.name, p.ids])).toEqual([
    ["없음 15", ["Dark15"]], ["B 30", ["b30a", "b30b"]], ["V 15", ["v15a", "v15b"]]])
  expect(groupPasses(["b30a", "v15a"], frames, []).map((p) => p.name)).toEqual(["b30a", "v15a"])

  const { map, id } = fixture(["SUBSET", "EXPTIME"])
  const loop = taskOf(map, id)
  expect(flowPasses(map, catalog, loop, rows).passes.map((p) => [p.name, p.values, p.ids.length])).toEqual([
    ["B 30", { SUBSET: "B", EXPTIME: "30" }, 2], ["V 15", { SUBSET: "V", EXPTIME: "15" }, 2]])
  // The 설정 tab lists the files' keywords with their values.
  expect(flowKeywordChoices(map, catalog, loop, rows)).toEqual([
    { keyword: "SUBSET", values: ["B", "V"] }, { keyword: "EXPTIME", values: ["15", "30"] }, { keyword: "IMAGETYP", values: ["object"] }])
  // The first pass goes to a member run alone.
  expect(loop.passed).toEqual({ item: ["b30a", "b30b"] })
})

test("the heading names the input and the keywords", () => {
  const { map, id } = fixture(["SUBSET", "EXPTIME"])
  expect(flowStatement(map, catalog, taskOf(map, id))).toBe("sci SUBSET, EXPTIME별로")
  const plain = withKeywords(map, id, [])
  expect(flowStatement(plain, catalog, taskOf(plain, id))).toBe("sci 파일마다")
  // By file: one file a pass through 이번 파일, every outside file to every pass.
  const inputs = memberPassInputs(plain, catalog, taskOf(plain, "proc"), rows)!
  expect(inputs.images).toEqual({ kind: "each" })
  expect(inputs.dark).toEqual({ kind: "same", ids: ["Dark15", "Dark30"] })
})

test("the loop input takes several connections, their files once each", () => {
  const { map, id } = fixture(["SUBSET", "EXPTIME"])
  // A second hand-picked list sharing a file with the first.
  let more = connect(addTask(map, { ...makeInstance(source, catalog, prefs, "late"), label: "late" }), "late", "files",
    { kind: "files", ids: ["v15b", "Dark30"], label: "파일" })
  more = syncPassOutputs(more, catalog, rows)
  more = connectFlow(more, catalog, rows, { source: "late", sourceHandle: "output", target: id, targetHandle: "items" })
  expect(more.connections.filter((c) => c.target === id && c.role === "items")).toHaveLength(2)
  const loop = taskOf(more, id)
  expect(flowFiles(more, catalog, loop)).toEqual({ ids: ["b30a", "v15a", "b30b", "v15b", "Dark30"], waiting: false })
  expect(flowStatement(more, catalog, loop)).toBe("sci, late SUBSET, EXPTIME별로")
  // Run alone, the loop gets both lists' files once each.
  expect(subflowRequest(more, catalog, "/work", id).flows[0].files).toEqual(["b30a", "v15a", "b30b", "v15b", "Dark30"])
})

test("outside files that differ in a keyword go to their pass; others reach every pass", () => {
  const frames = new Map(rows.map((r) => [r.id, r]))
  const passes = [{ SUBSET: "B", EXPTIME: "30" }, { SUBSET: "V", EXPTIME: "15" }]
  expect(matchPass(["FlatB", "FlatV"], frames, passes[1], passes)).toEqual({ ids: ["FlatV"], matched: true })
  expect(matchPass(["Zero"], frames, passes[1], passes)).toEqual({ ids: ["Zero"], matched: false })
  expect(matchPass(["coo"], frames, passes[1], passes)).toEqual({ ids: ["coo"], matched: false })

  const { map } = fixture(["SUBSET", "EXPTIME"])
  const inputs = memberPassInputs(map, catalog, taskOf(map, "proc"), rows)!
  expect(inputs.images).toEqual({ kind: "passes", passes: [{ name: "B 30", ids: ["b30a", "b30b"] }, { name: "V 15", ids: ["v15a", "v15b"] }], missing: [] })
  expect(inputs.zero).toEqual({ kind: "same", ids: ["Zero"] })
  expect(inputs.flat).toEqual({ kind: "passes", passes: [{ name: "B 30", ids: ["FlatB"] }, { name: "V 15", ids: ["FlatV"] }], missing: [] })
  expect(inputs.dark).toEqual({ kind: "passes", passes: [{ name: "B 30", ids: ["Dark30"] }, { name: "V 15", ids: ["Dark15"] }], missing: [] })
  // A reference taken in B reaches the V pass as it is, like a coordinate list.
  expect(inputs.reference).toEqual({ kind: "same", ids: ["pM67_B30_1"] })
  expect(inputs.coords).toEqual({ kind: "same", ids: ["coo"] })
  // A member run alone takes the first pass's match.
  expect(taskOf(map, "proc").firstPass).toEqual({
    [map.connections.find((c) => c.target === "proc" && c.role === "flat")!.id]: ["FlatB"],
    [map.connections.find((c) => c.target === "proc" && c.role === "dark")!.id]: ["Dark30"],
  })
  expect(payloadFor(map, "proc", catalog).inputs).toMatchObject({ images: ["b30a", "b30b"], flat: ["FlatB"], dark: ["Dark30"], zero: ["Zero"] })
  expect(loopIssues(map, catalog, rows)).toEqual([])
})

test("a pass with no matching file is a warning; unknown files wait for the run", () => {
  let { map } = fixture(["SUBSET", "EXPTIME"])
  map = connect(map, "darks", "files", { kind: "files", ids: ["Dark30", "Dark60"], label: "파일" }, false)
  map = syncContainerItems(syncPassOutputs(map, catalog, rows), catalog, rows)
  const dark = memberPassInputs(map, catalog, taskOf(map, "proc"), rows)!.dark
  expect(dark).toEqual({ kind: "passes", passes: [{ name: "B 30", ids: ["Dark30"] }, { name: "V 15", ids: [] }], missing: ["V 15"] })
  expect(loopIssues(map, catalog, rows)).toEqual([expect.objectContaining({
    severity: "warning", nodeId: "proc", message: "V 15 회차에 맞는 dark가 없습니다." })])
  // A result not yet run is not known yet.
  const waiting = { ...map, connections: map.connections.map((c) =>
    c.target === "proc" && c.role === "flat" ? { ...c, source: { kind: "pending" as const, taskId: "proc2" } } : c) }
  expect(memberPassInputs(waiting, catalog, taskOf(waiting, "proc"), rows)!.flat).toEqual({ kind: "unknown" })
})

test("runs send outside files with the loop to be matched per pass", () => {
  const { map, id } = fixture(["SUBSET", "EXPTIME"])
  const request = subflowRequest(map, catalog, "/work", id)
  const flow = request.flows[0] as { keywords?: string[]; fileInputs?: { target: string; role: string; files: string[] }[] }
  expect(flow.keywords).toEqual(["SUBSET", "EXPTIME"])
  expect(flow.fileInputs!.map((f) => [f.role, f.files])).toEqual([
    ["zero", ["Zero"]], ["flat", ["FlatB", "FlatV"]], ["dark", ["Dark15", "Dark30"]], ["reference", ["pM67_B30_1"]], ["coords", ["coo"]]])
  // The member's payload leaves them to the run.
  expect(request.nodes.find((n) => n.id === "proc")!.payload.inputs).toMatchObject({ flat: [], dark: [], zero: [] })
  // The whole workflow sends them as links instead.
  const whole = workflowRequest(map, catalog, "/work")
  expect(whole.links.filter((l) => l.target === "proc").map((l) => l.role).sort()).toEqual(["coords", "dark", "flat", "images", "reference", "zero"])
  expect((whole.flows[0] as { fileInputs?: unknown }).fileInputs).toBeUndefined()
  // Live checks see the first pass's file for a one-file input.
  const checked = workflowDiagnosticRequest(map, catalog, "/work")
  expect(checked.connections.find((c) => c.target === "proc" && c.role === "flat")!.source).toMatchObject({ ids: ["FlatB"] })
})

test("each keyword is a name in member output names", () => {
  const made = fixture(["SUBSET", "EXPTIME"])
  const id = made.id
  let map = made.map
  const member = taskOf(map, "proc")
  expect(memberVariables(map, catalog, member)).toEqual(["SUBSET", "EXPTIME"])
  const loop = loopVariables(map, catalog, member, rows)
  expect(loop).toEqual([{ variable: "SUBSET", value: "B" }, { variable: "EXPTIME", value: "30" }])
  const draft = { ...member.draft, outputs: { output: "p{SUBSET}_{EXPTIME}_{other}.fits" } }
  expect(loopOutputNames(draft, loop).outputs).toEqual({ output: "pB_30_{other}.fits" })
  expect(taskOf(map, id).draft.flow!.variable).toBe("SUBSET")
  // A member name follows the variable when its keyword goes, not when another is added.
  map = { ...map, tasks: map.tasks.map((t) => (t.id === "proc" ? { ...t, draft: { ...t.draft, outputs: { output: "Dark{EXPTIME}.fits" } } } : t)) }
  map = withKeywords(map, id, ["EXPTIME"])
  expect(taskOf(map, id).draft.flow!.variable).toBe("EXPTIME")
  map = withKeywords(map, id, ["SUBSET", "EXPTIME"])
  expect(taskOf(map, id).draft.flow!.variable).toBe("EXPTIME")
  expect(taskOf(map, "proc").draft.outputs).toEqual({ output: "Dark{EXPTIME}.fits" })
})

test("older loops keep their keyword on the loop; a split port no longer decides passes", () => {
  const { map, id } = fixture()
  // Before: the list came from a port split by SUBSET, the loop holding no keywords.
  const old: TaskMap = {
    ...map,
    tasks: map.tasks.map((t) =>
      t.id === "sci" ? { ...t, outputPorts: [{ id: "$default", name: "", files: ["*"], outputRole: "image", partition: { keyword: "SUBSET" } }] }
      : t.id === id ? { ...t, draft: { ...t.draft, flow: { variable: "SUBSET" } } } : t),
  }
  const loaded = migrateMap({ ...prefs, taskMap: JSON.parse(JSON.stringify(old)) }, catalog)
  expect(taskOf(loaded, id).draft.flow).toEqual({ variable: "SUBSET", keywords: ["SUBSET"] })
  // A stored partition becomes the keyword too.
  const stored = { ...map, tasks: map.tasks.map((t) => (t.id === id ? { ...t, draft: { ...t.draft, flow: { variable: "EXPTIME", partition: "EXPTIME" } as never } } : t)) }
  expect(taskOf(migrateMap({ ...prefs, taskMap: stored }, catalog), id).draft.flow).toEqual({ variable: "EXPTIME", keywords: ["EXPTIME"] })
  // A new loop fed by a split port still runs once per file.
  const split = { ...map, tasks: map.tasks.map((t) => t.id === "sci"
    ? { ...t, outputPorts: [{ id: "$default", name: "", files: ["*"], outputRole: "image", partition: { keyword: "SUBSET" } }] } : t) }
  const synced = syncContainerItems(split, catalog, rows)
  expect(flowPasses(synced, catalog, taskOf(synced, id), rows).passes).toHaveLength(4)
  expect(flowStatement(synced, catalog, taskOf(synced, id))).toBe("sci 파일마다")
})

test("outside files match by the keywords whose values the passes have, numbers by value", () => {
  const frames = new Map([
    image("FlatB", { SUBSET: "B", EXPTIME: "30.66011" }), image("FlatV", { SUBSET: "V", EXPTIME: "30.75525" }),
    image("Dark15", { EXPTIME: "15.0" }), image("Dark30", { EXPTIME: "30.0" }),
    image("Dark15i", { EXPTIME: "15" }), image("Dark30i", { EXPTIME: "30" }), image("Dark60", { EXPTIME: "60" }),
    image("Zero", { IMAGETYP: "zero" }), image("Ref", { SUBSET: "B", EXPTIME: "30" }), { id: "coo", label: "m67.coo", asset: "text" } as Frame,
  ].map((f) => [f.id, f]))
  const passes = [{ SUBSET: "B", EXPTIME: "30.0" }, { SUBSET: "V", EXPTIME: "15.0" }]
  const each = (ids: string[], all = passes) => all.map((pass) => matchPass(ids, frames, pass, all))
  // flatcombine changed EXPTIME, which no pass has: the flats match by SUBSET alone.
  expect(each(["FlatB", "FlatV"])).toEqual([{ ids: ["FlatB"], matched: true }, { ids: ["FlatV"], matched: true }])
  expect(each(["Dark15", "Dark30"])).toEqual([{ ids: ["Dark30"], matched: true }, { ids: ["Dark15"], matched: true }])
  // 15 is 15.0.
  expect(each(["Dark15i", "Dark30i"])).toEqual([{ ids: ["Dark30i"], matched: true }, { ids: ["Dark15i"], matched: true }])
  for (const ids of [["Zero"], ["Ref"], ["coo"]])
    expect(each(ids)).toEqual([{ ids, matched: false }, { ids, matched: false }])
  // Some values the passes have, some not: a pass without a file gets none.
  const byTime = [{ EXPTIME: "15" }, { EXPTIME: "30" }]
  expect(each(["Dark15i", "Dark60"], byTime)).toEqual([{ ids: ["Dark15i"], matched: true }, { ids: [], matched: true }])
})
