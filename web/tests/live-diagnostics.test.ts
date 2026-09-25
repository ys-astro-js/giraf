import { expect, test } from "bun:test"
import { createDiagnosticStore } from "../src/lib/diagnostics"
import { createWorkflowDiagnosticsController } from "../src/lib/live-diagnostics"
import { emptyMap, makeInstance, payloadFor, workflowDiagnosticRequest, type TaskMap } from "../src/lib/task-map"
import type { Catalog, Preferences, Spec } from "../src/lib/workbench"

const issue = (message: string, nodeId = "n", connectionId?: string) => ({
  id: `${nodeId}:${message}`,
  severity: "error" as const,
  message,
  nodeId,
  connectionId,
})

test("current problems replace together, survive history clear, and never persist", () => {
  const saved: string[] = []
  const store = createDiagnosticStore({ getItem: () => null, setItem: (_, value) => saved.push(value) })
  store.report({ severity: "error", message: "old run", source: "run", nodeId: "n" })
  store.replaceCurrent("doc", [issue("bad input", "n", "e")])
  expect(store.getSnapshot().map(d => d.message)).toEqual(["bad input", "old run"])
  expect(store.currentForNode("n")).toHaveLength(1)
  expect(store.currentForConnection("e")).toHaveLength(1)
  store.replaceCurrent("doc", [])
  expect(store.getSnapshot().map(d => d.message)).toEqual(["old run"])
  store.replaceCurrent("doc", [issue("bad input", "n", "e")])
  store.clear()
  expect(store.getSnapshot().map(d => d.message)).toEqual(["bad input"])
  store.replaceCurrent("doc", [])
  expect(store.getSnapshot()).toHaveLength(0)
  store.replaceCurrent("doc", [issue("bad input")])
  expect(store.getSnapshot()).toHaveLength(1)
  store.replaceCurrent("next", [])
  expect(store.getSnapshot()).toHaveLength(0)
  expect(saved.every(value => !value.includes("bad input"))).toBe(true)

  const spec: Spec = { name: "demo", title: "demo", package: "demo", adapter: "generic", parameters: [], inputs: [{ name: "input", label: "Input", kind: "image", multiple: false }], outputs: [{ name: "output", kind: "image", default: "out.fits" }], output: null, kind: "image" }
  const catalog: Catalog = { version: "test", tasks: [spec], ccdproc: { inputs: [], parameters: [] }, ccdred: [], exam: {} }
  const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
  const map: TaskMap = { ...emptyMap(), tasks: [makeInstance(spec, catalog, prefs, "a"), makeInstance(spec, catalog, prefs, "b")], connections: [{ id: "edge", target: "b", role: "input", source: { kind: "files", ids: ["one", "two"], label: "files" } }] }
  expect(() => payloadFor(map, "b", catalog)).toThrow("파일 한 개")
  expect(workflowDiagnosticRequest(map, catalog, "/tmp").nodes[1].payload.inputs.input).toEqual(["one", "two"])
  map.tasks[1].task = "uninstalled.task"
  expect(workflowDiagnosticRequest(map, catalog, "/tmp").nodes[1].payload.task).toBe("uninstalled.task")
  expect(() => payloadFor(map, "b", catalog)).toThrow("작업 정의")
  map.tasks[1].task = spec.name
  map.connections[0].source = { kind: "pending", taskId: "a" }
  expect(workflowDiagnosticRequest(map, catalog, "/tmp").connections[0].source.kind).toBe("pending")
  map.runs = [{ id: "run", instanceId: "a", state: "completed", products: [{ id: "generated", label: "out.fits", asset: "image", role: "output" }] }]
  const checked = workflowDiagnosticRequest(map, catalog, "/tmp")
  expect(checked.nodes[1].payload.inputs.input).toEqual(["generated"])
  expect(checked.connections[0].source).toMatchObject({ kind: "result", ids: ["generated"] })
  expect(map.connections[0].source.kind).toBe("pending")
  map.connections[0].source = { kind: "result", taskId: "a", runId: "old", ids: ["pinned"], label: "old result" }
  expect(workflowDiagnosticRequest(map, catalog, "/tmp").nodes[1].payload.inputs.input).toEqual(["pinned"])
})

test("controller debounces edits, merges in-flight changes, rejects old documents and recovers after failure", async () => {
  const store = createDiagnosticStore()
  const pending: { resolve: (value: { diagnostics: ReturnType<typeof issue>[] }) => void; reject: (error: Error) => void }[] = []
  const calls: unknown[] = []
  const controller = createWorkflowDiagnosticsController(store, payload => {
    calls.push(payload)
    return new Promise((resolve, reject) => pending.push({ resolve, reject }))
  }, 20)
  controller.change("a", { version: 1 })
  controller.change("a", { version: 2 })
  await Bun.sleep(30)
  expect(calls).toEqual([{ version: 2 }])
  controller.change("a", { version: 3 })
  await Bun.sleep(30)
  expect(calls).toHaveLength(1)
  pending[0].resolve({ diagnostics: [issue("stale")] })
  await Bun.sleep(5)
  expect(store.getSnapshot()).toHaveLength(0)
  expect(calls).toEqual([{ version: 2 }, { version: 3 }])
  pending[1].reject(new Error("network"))
  await Bun.sleep(0)
  expect(controller.getFailure()).toBe("network")
  controller.change("b", { version: 4 }, true)
  expect(store.getSnapshot()).toHaveLength(0)
  await Bun.sleep(5)
  pending[2].resolve({ diagnostics: [issue("new")] })
  await Bun.sleep(0)
  expect(store.getSnapshot()[0].message).toBe("new")
  expect(controller.getFailure()).toBe("")
  controller.recheck()
  controller.recheck()
  await Bun.sleep(5)
  expect(calls).toHaveLength(4)
  pending[3].resolve({ diagnostics: [] })
  await Bun.sleep(0)
  controller.change("old", { version: 5 }, true)
  await Bun.sleep(5)
  controller.change("replacement", { version: 6 }, true)
  pending[4].resolve({ diagnostics: [issue("old document")] })
  await Bun.sleep(5)
  expect(store.getSnapshot()).toHaveLength(0)
  expect(calls).toHaveLength(6)
  pending[5].resolve({ diagnostics: [issue("replacement document")] })
  await Bun.sleep(0)
  expect(store.getSnapshot()[0].message).toBe("replacement document")
  controller.dispose()

  const signals: (AbortSignal | undefined)[] = []
  const slowPending: ((value: { diagnostics: ReturnType<typeof issue>[] }) => void)[] = []
  const request = (_payload: unknown, signal?: AbortSignal) => {
    signals.push(signal)
    return new Promise<{ diagnostics: ReturnType<typeof issue>[] }>(resolve => slowPending.push(resolve))
  }
  const slow = createWorkflowDiagnosticsController(store, request, 0)
  slow.change("slow", {}, true)
  await Bun.sleep(5)
  slow.recheck()
  slow.recheck()
  await Bun.sleep(5)
  expect(slowPending).toHaveLength(1)
  slowPending[0]({ diagnostics: [issue("slow response")] })
  await Bun.sleep(5)
  expect(store.getSnapshot()[0]?.message).toBe("slow response")
  expect(slowPending).toHaveLength(2)
  slow.dispose()
  expect(signals[1]?.aborted).toBe(true)
  // Effect cleanup followed by setup must use a fresh controller.
  const replacement = createWorkflowDiagnosticsController(store, request, 0)
  replacement.change("replacement", {}, true)
  await Bun.sleep(5)
  slowPending[1]({ diagnostics: [issue("disposed response")] })
  await Bun.sleep(0)
  expect(store.getSnapshot()).toHaveLength(0)
  slowPending[2]({ diagnostics: [issue("remounted response")] })
  await Bun.sleep(0)
  expect(store.getSnapshot()[0]?.message).toBe("remounted response")
  replacement.dispose()
})
