import { expect, test } from "bun:test"
import { workflowDocument } from "../src/lib/workflow-document"
import { emptyMap } from "../src/lib/task-map"
import type { Preferences } from "../src/lib/workbench"

test("export excludes the stale graph and file cache without changing the live document", () => {
  const saved = emptyMap()
  const current = emptyMap()
  current.view.zoom = 2
  current.runs = [{ id: "run", instanceId: "task", state: "completed", products: [{ id: "output", label: "result.fits" }] }]
  current.connections = [{ id: "edge", target: "task", role: "input", source: { kind: "result", runId: "run", ids: ["output"] } }]
  const prefs: Preferences & { files: unknown[] } = {
    _document: { path: "/local/.giraf/workflows/private.json", name: "보정", saved: true },
    taskMap: saved,
    files: [{ id: "unrelated", history: "large cache".repeat(10000) }],
    drafts: {}, backend: "iraf", mapping: { filter: "FILTER" }, instrument: ["instrument"],
    packageValues: { verbose: true }, parameterSets: { task: { options: { value: 1 } } },
  }
  const before = structuredClone(prefs)
  const exported = JSON.parse(JSON.stringify(workflowDocument(prefs, current)))
  expect(exported).toEqual({
    format: "giraf-workflow", version: 1, name: "보정", taskMap: current,
    preferences: {
      drafts: {}, backend: "iraf", mapping: { filter: "FILTER" }, instrument: ["instrument"],
      packageValues: { verbose: true }, parameterSets: { task: { options: { value: 1 } } },
    },
  })
  expect(prefs).toEqual(before)
  expect(JSON.stringify(exported).length).toBeLessThan(2000)
})

test("unsaved workflows retain the import format and default name", () => {
  const prefs: Preferences = { drafts: {}, backend: "iraf", mapping: {}, instrument: [], packageValues: {} }
  expect(workflowDocument(prefs, emptyMap())).toEqual({
    format: "giraf-workflow", version: 1, name: "워크플로우", taskMap: emptyMap(), preferences: prefs,
  })
})
