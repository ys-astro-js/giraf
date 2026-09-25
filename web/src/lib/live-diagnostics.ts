import type { createDiagnosticStore } from "./diagnostics"

type Store = ReturnType<typeof createDiagnosticStore>
export type WorkflowIssue = { id: string; severity: "warning" | "error"; message: string; nodeId: string; connectionId?: string }
type Response = { diagnostics: WorkflowIssue[] }

export async function requestWorkflowDiagnostics(payload: unknown, signal?: AbortSignal): Promise<Response> {
  const response = await fetch("/api/workflow-diagnostics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal,
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || "워크플로우 검사에 실패했습니다.")
  if (!Array.isArray(data.diagnostics) || !data.diagnostics.every((issue: unknown) =>
    !!issue && typeof issue === "object" &&
    "id" in issue && typeof issue.id === "string" &&
    "nodeId" in issue && typeof issue.nodeId === "string" &&
    "message" in issue && typeof issue.message === "string" &&
    "severity" in issue && (issue.severity === "error" || issue.severity === "warning") &&
    (!("connectionId" in issue) || typeof issue.connectionId === "string")
  )) throw new Error("검사 응답 형식이 올바르지 않습니다.")
  return data
}

export function createWorkflowDiagnosticsController(
  store: Store,
  request: (payload: unknown, signal?: AbortSignal) => Promise<Response> = requestWorkflowDiagnostics,
  debounceMs = 300
) {
  let documentId = ""
  let payload: unknown
  let nodeLabels: Record<string, string> = {}
  let version = 0
  let dueAt = 0
  let lastRecheckAt = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let requested = false
  let activeRequest: AbortController | undefined
  let disposed = false
  let failure = ""
  const listeners = new Set<() => void>()
  const setFailure = (message: string) => {
    if (failure === message) return
    failure = message
    listeners.forEach(listener => listener())
  }
  async function inspect() {
    if (disposed || running || !documentId) return
    running = true
    requested = false
    activeRequest = new AbortController()
    const inspectedDocument = documentId
    const inspectedVersion = version
    try {
      const result = await request(payload, activeRequest.signal)
      if (!disposed && inspectedDocument === documentId && inspectedVersion === version) {
        store.replaceCurrent(documentId, result.diagnostics, nodeLabels)
        setFailure("")
      }
    } catch (error) {
      if (!disposed && inspectedDocument === documentId && inspectedVersion === version)
        setFailure(error instanceof Error ? error.message : String(error))
    } finally {
      running = false
      activeRequest = undefined
      if (!disposed && requested) {
        schedule()
      }
    }
  }
  function schedule() {
    clearTimeout(timer)
    if (running) return
    timer = setTimeout(inspect, Math.max(0, dueAt - Date.now()))
  }
  return {
    change(nextDocument: string, nextPayload: unknown, immediate = false) {
      if (disposed) return
      const changedDocument = documentId !== nextDocument
      if (changedDocument) {
        store.clearCurrent()
        setFailure("")
      }
      documentId = nextDocument
      payload = nextPayload
      nodeLabels = {}
      if (nextPayload && typeof nextPayload === "object" && "nodes" in nextPayload && "connections" in nextPayload && Array.isArray(nextPayload.nodes) && Array.isArray(nextPayload.connections)) {
        nodeLabels = Object.fromEntries(nextPayload.nodes.map((node: { id: string; label?: string }) => [node.id, node.label || node.id]))
        store.pruneCurrent(nextPayload.nodes.map((node: { id: string }) => node.id), nextPayload.connections.map((edge: { id: string }) => edge.id))
      }
      version++
      requested = true
      dueAt = Date.now() + (immediate || changedDocument ? 0 : debounceMs)
      schedule()
    },
    recheck() {
      if (!documentId || disposed) return
      const now = Date.now()
      if (now - lastRecheckAt < 250) return
      lastRecheckAt = now
      requested = true
      // A periodic check must not invalidate the current result or bypass an edit's debounce.
      dueAt = Math.max(dueAt, now)
      schedule()
    },
    getFailure: () => failure,
    subscribeFailure(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      activeRequest?.abort()
      listeners.clear()
    },
  }
}
