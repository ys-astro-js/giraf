import { afterEach, expect, test } from "bun:test"
import {
  createDiagnosticStore,
  collectResponseDiagnostics,
  installRuntimeDiagnostics,
  resolveDiagnosticNode,
  copyDiagnosticRunId,
} from "../src/lib/diagnostics"
import { api } from "../src/lib/workbench"
import { diagnostics } from "../src/lib/diagnostics"

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  diagnostics.clear()
})

test("session store deduplicates snapshots, not distinct jobs, and clear keeps observed records cleared", () => {
  const store = createDiagnosticStore()
  let notifications = 0
  const unsubscribe = store.subscribe(() => notifications++)
  const first = {
    severity: "error" as const,
    message: "입력 파일 없음",
    source: "imcopy",
    key: "job:a:failed",
  }
  store.report(first)
  const snapshot = store.getSnapshot()
  store.report(first)
  expect(store.getSnapshot()).toBe(snapshot)
  store.report({ ...first, key: "job:b:failed" })
  expect(store.getSnapshot()).toHaveLength(2)
  expect(notifications).toBe(2)
  store.clear("error")
  store.report(first)
  expect(store.getSnapshot()).toHaveLength(0)
  store.report({ severity: "warning", message: "확인 필요", source: "검사" })
  expect(store.getSnapshot()[0].severity).toBe("warning")
  expect(store.hasMessage("확인 필요", "warning")).toBe(true)
  expect(store.hasMessage("확인 필요", "error")).toBe(false)
  unsubscribe()
  expect(createDiagnosticStore().getSnapshot()).toHaveLength(0)
})

test("collects validation, file errors, failed jobs, workflow failures and only explicit log diagnostics", () => {
  const store = createDiagnosticStore()
  collectResponseDiagnostics(
    "validate",
    { warnings: ["노출 시간 확인"], errors: ["입력 필요"] },
    store
  )
  collectResponseDiagnostics(
    "workspace",
    { files: [{ id: "f", label: "broken.fits", error: "헤더 읽기 실패" }] },
    store
  )
  const job = {
    id: "j",
    name: "imcopy",
    state: "failed",
    message: "실행 실패",
    log: "normal error_count=0\nWARNING: missing exposure\nERROR: no image\nWarning: missing exposure",
  }
  collectResponseDiagnostics("jobs", [job], store)
  collectResponseDiagnostics("jobs", [job], store)
  collectResponseDiagnostics("workflow", { id: "w", state: "running" }, store)
  collectResponseDiagnostics(
    "workflow",
    { id: "w", state: "failed", message: "연결 누락", jobs: [] },
    store
  )
  expect(
    store.getSnapshot().filter((d) => d.severity === "warning")
  ).toHaveLength(2)
  expect(
    store.getSnapshot().filter((d) => d.severity === "error")
  ).toHaveLength(5)
  expect(
    store.getSnapshot().some((d) => d.message.includes("error_count"))
  ).toBe(false)
  expect(store.getSnapshot().some((d) => d.source === "broken.fits")).toBe(true)
})

test("same job errors in workflow snapshots use the same identity and cancellation is not an error", () => {
  const store = createDiagnosticStore()
  const job = { id: "j", name: "imcopy", state: "failed", message: "파일 없음" }
  collectResponseDiagnostics("jobs", [job], store)
  collectResponseDiagnostics(
    "workflow",
    {
      id: "w",
      state: "failed",
      message: "파일 없음",
      jobs: [job],
      currentJob: job,
    },
    store
  )
  collectResponseDiagnostics(
    "job",
    { id: "c", name: "imcopy", state: "cancelled", message: "취소" },
    store
  )
  expect(store.getSnapshot()).toHaveLength(1)
})

test("API captures HTTP, network and invalid JSON failures while preserving rejection", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: "진단 테스트 요청 실패" }), {
      status: 400,
    })) as typeof fetch
  await expect(api("diagnostic-test")).rejects.toThrow("진단 테스트 요청 실패")
  expect(
    diagnostics.getSnapshot().some((d) => d.message === "진단 테스트 요청 실패")
  ).toBe(true)
  diagnostics.clear()
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ errors: ["첫 번째 검증 실패", "두 번째 검증 실패"] }),
      { status: 400 }
    )) as typeof fetch
  await expect(api("diagnostic-validation")).rejects.toThrow(
    "첫 번째 검증 실패"
  )
  expect(diagnostics.getSnapshot()).toHaveLength(2)
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch")
  }) as typeof fetch
  await expect(api("diagnostic-network")).rejects.toThrow()
  expect(
    diagnostics
      .getSnapshot()
      .some((d) => d.source.includes("diagnostic-network"))
  ).toBe(true)
  globalThis.fetch = (async () => new Response("not json")) as typeof fetch
  await expect(api("diagnostic-json")).rejects.toThrow()
  expect(
    diagnostics.getSnapshot().some((d) => d.source.includes("diagnostic-json"))
  ).toBe(true)
})

test("runtime listeners capture uncaught failures and detach cleanly", () => {
  const target = new EventTarget()
  const store = createDiagnosticStore()
  const detach = installRuntimeDiagnostics(target, store)
  target.dispatchEvent(
    Object.assign(new Event("error"), { message: "Runtime failure" })
  )
  target.dispatchEvent(
    Object.assign(new Event("unhandledrejection"), {
      reason: new Error("Async failure"),
    })
  )
  expect(store.getSnapshot()).toHaveLength(2)
  detach()
  target.dispatchEvent(
    Object.assign(new Event("error"), { message: "Detached failure" })
  )
  expect(store.getSnapshot()).toHaveLength(2)
})

test("restored terminal workflows do not become new session errors on repeated polls", () => {
  const store = createDiagnosticStore()
  const previous = {
    id: "previous",
    state: "failed",
    message: "imalign: 영상 선택 또는 순서가 변경되었습니다.",
    jobs: [],
  }
  collectResponseDiagnostics("workflow", previous, store)
  collectResponseDiagnostics("workflow", previous, store)
  expect(store.getSnapshot()).toHaveLength(0)
  collectResponseDiagnostics("workflow", { id: "new", state: "running" }, store)
  collectResponseDiagnostics("workflow", { ...previous, id: "new" }, store)
  expect(store.getSnapshot()).toHaveLength(1)
  store.clear()
  collectResponseDiagnostics("workflow", { ...previous, id: "new" }, store)
  expect(store.getSnapshot()).toHaveLength(0)
})

test("an immediately failed workflow-run response is still reported", () => {
  const store = createDiagnosticStore()
  collectResponseDiagnostics(
    "workflow-run",
    {
      id: "immediate",
      state: "failed",
      message: "실행 준비 실패",
      jobs: [],
    },
    store
  )
  expect(store.getSnapshot()).toHaveLength(1)
  expect(store.getSnapshot()[0].severity).toBe("error")
})

test("job diagnostics retain their full run identity and node, including later enriched snapshots", () => {
  const store = createDiagnosticStore()
  const job = {
    id: "run-abcdef",
    name: "imcopy",
    state: "failed",
    message: "실패",
    log: "WARNING: 확인 필요",
  }
  collectResponseDiagnostics("job", job, store)
  collectResponseDiagnostics(
    "job",
    { ...job, manifest: { instanceId: "node-a" } },
    store
  )
  expect(store.getSnapshot()).toHaveLength(2)
  for (const entry of store.getSnapshot()) {
    expect(entry).toMatchObject({
      runId: "run-abcdef",
      nodeId: "node-a",
      source: "imcopy",
    })
  }
  collectResponseDiagnostics(
    "workflow-run",
    {
      id: "wf",
      state: "failed",
      currentTask: "node-b",
      message: "연결 오류",
      jobs: [],
    },
    store
  )
  expect(store.getSnapshot()[0].nodeId).toBe("node-b")
})

test("diagnostics navigate only to a present node, using run ownership rather than task names", () => {
  const map = {
    tasks: [{ id: "node-a" }, { id: "node-b" }],
    runs: [{ id: "run-a", instanceId: "node-a" }],
  }
  expect(resolveDiagnosticNode({ nodeId: "node-b" }, map)).toBe("node-b")
  expect(resolveDiagnosticNode({ runId: "run-a" }, map)).toBe("node-a")
  expect(
    resolveDiagnosticNode({ nodeId: "deleted", runId: "missing" }, map)
  ).toBeUndefined()
  expect(resolveDiagnosticNode({}, map)).toBeUndefined()
})

test("clicking an abbreviated run ID copies its full value and propagates clipboard failures", async () => {
  const values: string[] = []
  await copyDiagnosticRunId("20260922-004951-0b3cc9", {
    writeText: async (value) => {
      values.push(value)
    },
  })
  expect(values).toEqual(["20260922-004951-0b3cc9"])
  await expect(
    copyDiagnosticRunId("run-abcdef", {
      writeText: async () => {
        throw new Error("clipboard denied")
      },
    })
  ).rejects.toThrow("clipboard denied")
})

test("API validation failures retain the originating node before any run exists", async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ errors: ["노드 입력 오류"] }), {
      status: 400,
    })) as typeof fetch
  await expect(
    api("task-validate", { instanceId: "node-validation" })
  ).rejects.toThrow()
  expect(
    diagnostics
      .getSnapshot()
      .find((entry) => entry.message === "노드 입력 오류")?.nodeId
  ).toBe("node-validation")
  await expect(
    api("task-validate", { instanceId: "another-node" })
  ).rejects.toThrow()
  expect(
    diagnostics
      .getSnapshot()
      .filter((entry) => entry.message === "노드 입력 오류")
      .map((entry) => entry.nodeId)
  ).toEqual(["another-node", "node-validation"])
})
