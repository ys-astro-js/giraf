import { expect, test } from "bun:test"
import { workflowDocument } from "../src/lib/workflow-document"
import { emptyMap, type Instance } from "../src/lib/task-map"
import { makeDraft, type Preferences } from "../src/lib/workbench"

const prefs: Preferences = {
  drafts: { unused: makeDraft(undefined, { inputs: { input: ["private-file"] } }) },
  backend: "iraf", mapping: {}, instrument: ["private-instrument"], packageValues: {},
}
const task = (id: string): Instance => ({
  id, task: "imcombine", label: id,
  draft: makeDraft(undefined, {
    parameters: { combine: "median" }, inputs: { input: ["private-file"] },
    alignmentBinding: { reference: ["private-reference"], input: ["private-file"] },
    outputs: { output: "combined.fits" }, textInputs: { coords: "10 20" },
  }),
  preprocess: makeDraft(undefined, { inputs: { zero: ["private-bias"] }, parameters: { trim: "yes" } }),
  mapping: { filter: "FILTER" }, instrument: ["private-instrument"], packageValues: { verbose: true },
  backend: "iraf", expressions: { input: "*.fits" }, filePolicy: { mode: "copy", backup: true },
  position: { x: 120, y: 240 }, parameterSets: { options: { value: 1 } },
  outputPorts: [{ id: "filtered", name: "R band", files: ["*_R.fits"], outputRole: "output" }],
})

test("shared workflows omit execution data, selected files, global drafts and viewport state", () => {
  const current = emptyMap()
  current.tasks = [task("source"), task("target")]
  current.subflows = [{ id: "group", name: "보정", position: { x: 0, y: 0 }, width: 500, height: 400 }]
  current.tasks[0].subflowId = "group"
  current.view = { ...current.view, selected: "source", zoom: 2, x: 100, focus: true, coordinateSystem: "react-flow" }
  current.runs = [{ id: "private-run", instanceId: "source", state: "completed", products: [{ id: "private-output", label: "private.fits", history: { huge: "cache".repeat(10000) } }] }]
  const cached = { ...prefs, taskMap: current, files: [{ path: "/private/image.fits" }],
    _document: { path: "/private/workflow.json", name: "보정", saved: true } }
  const before = structuredClone(cached)
  const exported = workflowDocument(cached, current)
  expect(exported.preferences).toEqual({})
  expect(exported.taskMap.runs).toEqual([])
  expect(exported.taskMap.view).toEqual({ ...emptyMap().view, coordinateSystem: "react-flow" })
  expect(exported.taskMap.subflows).toEqual(current.subflows)
  for (const [i, item] of exported.taskMap.tasks.entries()) {
    expect(item).toEqual({ ...current.tasks[i], instrument: [],
      draft: { ...current.tasks[i].draft, inputs: {}, alignmentBinding: undefined },
      preprocess: { ...current.tasks[i].preprocess, inputs: {}, alignmentBinding: undefined },
    })
  }
  expect(exported.name).toBe("보정")
  expect(JSON.stringify(exported)).not.toContain("private")
  expect(JSON.stringify(exported).length).toBeLessThan(JSON.stringify(cached).length / 10)
  expect(cached).toEqual(before)
})

test("internal result connections become future outputs while external file and result selections are removed", () => {
  const map = emptyMap()
  map.tasks = [task("source"), task("target")]
  map.connections = [
    { id: "internal", target: "target", role: "input", targetGroup: { filter: "R" }, source: {
      kind: "result", taskId: "source", runId: "private-run", ids: ["private-output"], label: "private label",
      outputRole: "output", group: { filter: "R" }, port: "output-custom:filtered", files: ["*_R.fits"],
    } },
    { id: "future", target: "target", role: "zero", source: { kind: "pending", taskId: "source", outputRole: "output" } },
    { id: "file", target: "source", role: "input", source: { kind: "files", ids: ["private-file"], label: "private" } },
    { id: "external", target: "source", role: "zero", source: { kind: "result", runId: "external", ids: ["private-output"] } },
    { id: "removed", target: "source", role: "dark", source: { kind: "result", taskId: "removed", runId: "external", ids: ["private-output"] } },
  ]
  const before = structuredClone(map)
  const result = workflowDocument(prefs, map).taskMap
  expect(result.connections).toEqual([
    { ...map.connections[0], source: { kind: "pending", taskId: "source", outputRole: "output", group: { filter: "R" }, port: "output-custom:filtered", files: ["*_R.fits"] } },
    map.connections[1],
  ])
  expect(map).toEqual(before)
})

test("unsaved workflows retain the import format and default name", () => {
  expect(workflowDocument(prefs, emptyMap())).toEqual({
    format: "giraf-workflow", version: 1, name: "워크플로우", taskMap: emptyMap(), preferences: {},
  })
})
