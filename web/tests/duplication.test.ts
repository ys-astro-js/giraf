import { expect, test } from "bun:test"
import { duplicateTask, emptyMap, type Instance } from "../src/lib/task-map"
import { makeDraft } from "../src/lib/workbench"

test("node duplication preserves independent settings and incoming connections without reusing execution or outgoing links", () => {
  const source: Instance = {
    id: "source", task: "imcopy", label: "영상", description: "설명",
    draft: makeDraft(undefined, { parameters: { verbose: true }, inputs: { input: ["file"] }, textInputs: { coords: "10 20" }, outputs: { output: "copy.fits" } }),
    preprocess: makeDraft(undefined, { parameters: { trim: "yes" } }),
    mapping: { filter: "FILTER" }, instrument: ["instrument"], packageValues: { value: 2 },
    backend: "cl", expressions: { input: "*.fits" }, filePolicy: { mode: "copy", backup: true },
    parameterSets: { options: { enabled: true } }, outputPorts: [{ id: "port", name: "R", files: ["R*"], outputRole: "output" }],
    position: { x: 100, y: 100 }, subflowId: "group", collapsed: true,
  }
  const map = { ...emptyMap(), tasks: [source], connections: [
    { id: "in", target: "source", role: "input", source: { kind: "files" as const, ids: ["file"], label: "파일" } },
    { id: "out", target: "other", role: "input", source: { kind: "pending" as const, taskId: "source" } },
  ], runs: [{ id: "run", instanceId: "source", state: "completed", products: [] }] }
  const before = structuredClone(map)
  const next = duplicateTask(map, "source", { x: 160, y: 160 })
  const copy = next.tasks[1]
  expect(copy.id).not.toBe(source.id)
  expect(copy).toEqual({ ...source, id: copy.id, position: { x: 160, y: 160 } })
  expect(next.view.selected).toBe(copy.id)
  expect(next.connections).toHaveLength(3)
  expect(next.connections[2]).toEqual({ ...map.connections[0], id: next.connections[2].id, target: copy.id })
  expect(next.connections[2].id).not.toBe("in")
  expect(next.runs).toEqual(map.runs)
  copy.draft.inputs.input.push("another")
  copy.parameterSets!.options.enabled = false
  expect(map).toEqual(before)
})

test("duplicating a missing node leaves the map unchanged", () => {
  const map = emptyMap()
  expect(duplicateTask(map, "missing", { x: 0, y: 0 })).toBe(map)
})
