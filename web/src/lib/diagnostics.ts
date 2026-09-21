export type DiagnosticSeverity = "warning" | "error"
export type Diagnostic = {
  id: string
  severity: DiagnosticSeverity
  message: string
  source: string
  timestamp: number
  runId?: string
  nodeId?: string
}
type Report = Omit<Diagnostic, "id" | "timestamp"> & { key?: string }

// Keys survive clearing so polling does not restore records the user removed.
// All state is in memory and starts fresh on page reload.
export function createDiagnosticStore() {
  let entries: Diagnostic[] = []
  const seen = new Set<string>()
  const seenMessages = new Set<string>()
  const sessionWorkflows = new Set<string>()
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => entries,
    observeWorkflow(id: string, state: string, started: boolean) {
      if (
        started ||
        ["running", "waiting", "confirmation", "cancelling"].includes(state)
      )
        sessionWorkflows.add(id)
      return sessionWorkflows.has(id)
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    hasMessage(
      message: string,
      severity: DiagnosticSeverity = "error",
      nodeId?: string
    ) {
      return seenMessages.has(
        JSON.stringify(
          nodeId
            ? [severity, message.trim(), nodeId]
            : [severity, message.trim()]
        )
      )
    },
    report(input: Report) {
      const message = input.message.trim()
      if (!message) return
      const id =
        input.key ??
        JSON.stringify([
          input.severity,
          input.source,
          input.nodeId,
          input.runId,
          message,
        ])
      if (seen.has(id)) {
        const previous = entries.find((entry) => entry.id === id)
        if (
          previous &&
          ((!previous.nodeId && input.nodeId) ||
            (!previous.runId && input.runId))
        ) {
          entries = entries.map((entry) =>
            entry.id === id
              ? {
                  ...entry,
                  nodeId: entry.nodeId || input.nodeId,
                  runId: entry.runId || input.runId,
                }
              : entry
          )
          listeners.forEach((listener) => listener())
        }
        return
      }
      seen.add(id)
      seenMessages.add(JSON.stringify([input.severity, message]))
      if (input.nodeId)
        seenMessages.add(
          JSON.stringify([input.severity, message, input.nodeId])
        )
      entries = [
        {
          id,
          severity: input.severity,
          message,
          source: input.source,
          runId: input.runId,
          nodeId: input.nodeId,
          timestamp: Date.now(),
        },
        ...entries,
      ]
      listeners.forEach((listener) => listener())
    },
    clear(severity?: DiagnosticSeverity) {
      entries = severity
        ? entries.filter((entry) => entry.severity !== severity)
        : []
      listeners.forEach((listener) => listener())
    },
  }
}
export const diagnostics = createDiagnosticStore()
type Store = ReturnType<typeof createDiagnosticStore>
type RecordData = Record<string, unknown>
function record(value: unknown): value is RecordData {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}

export function collectResponseDiagnostics(
  action: string,
  data: unknown,
  store: Store = diagnostics,
  context: { nodeId?: string } = {}
) {
  const route = action.split("?")[0]
  if (Array.isArray(data)) {
    if (route === "jobs") data.forEach((job) => collectJob(job, store))
    return
  }
  if (!record(data)) return
  const source = `요청: ${route}`
  for (const message of strings(data.warnings))
    store.report({ severity: "warning", message, source, ...context })
  for (const message of strings(data.errors))
    store.report({ severity: "error", message, source, ...context })
  if (Array.isArray(data.files))
    for (const file of data.files) {
      if (record(file) && typeof file.error === "string")
        store.report({
          severity: "error",
          message: file.error,
          source: String(file.label || file.id),
          key: `file:${file.id}:${file.error}`,
        })
    }
  if (route === "job" || route === "task-run" || route === "run")
    collectJob(data, store)
  if (route.startsWith("workflow") && typeof data.state === "string") {
    // A restored terminal snapshot is history, not a failure in this session.
    const observed =
      typeof data.id === "string" &&
      store.observeWorkflow(data.id, data.state, route === "workflow-run")
    const jobs = [
      ...(Array.isArray(data.jobs) ? data.jobs : []),
      data.currentJob,
    ].filter(record)
    jobs.forEach((job) => collectJob(job, store))
    if (
      observed &&
      data.state === "failed" &&
      !jobs.some((job) => job.state === "failed")
    ) {
      store.report({
        severity: "error",
        message: String(data.message || "워크플로우 실행 실패"),
        source: "워크플로우",
        nodeId:
          typeof data.currentTask === "string" ? data.currentTask : undefined,
        key: `workflow:${data.id}:failed`,
      })
    }
  }
}

function collectJob(data: unknown, store: Store) {
  if (!record(data) || typeof data.id !== "string") return
  const source = String(data.name || data.task || "작업")
  const manifest = record(data.manifest) ? data.manifest : undefined
  const nodeId =
    typeof data.instanceId === "string"
      ? data.instanceId
      : typeof manifest?.instanceId === "string"
        ? manifest.instanceId
        : undefined
  const context = { runId: data.id, nodeId }
  if (data.state === "failed")
    store.report({
      severity: "error",
      message: String(data.message || "작업 실행 실패"),
      source,
      ...context,
      key: `job:${data.id}:failed`,
    })
  if (typeof data.log !== "string") return
  for (const line of data.log.split(/\r?\n/)) {
    const match = line.match(
      /^\s*(?:\[(WARNING|WARN|ERROR|FATAL)\]|(WARNING|WARN|ERROR|FATAL|경고|오류)\s*:)\s*(.+)$/i
    )
    if (!match) continue
    const level = (match[1] || match[2]).toLowerCase()
    const severity = ["warning", "warn", "경고"].includes(level)
      ? "warning"
      : "error"
    const message = match[3].trim()
    if (severity === "error" && message === data.message) continue
    store.report({
      severity,
      message,
      source,
      ...context,
      key: `job:${data.id}:${severity}:${message}`,
    })
  }
}

export function resolveDiagnosticNode(
  entry: Pick<Diagnostic, "nodeId" | "runId">,
  map: { tasks: { id: string }[]; runs: { id: string; instanceId: string }[] }
) {
  const nodeId =
    entry.nodeId || map.runs.find((run) => run.id === entry.runId)?.instanceId
  return map.tasks.some((task) => task.id === nodeId) ? nodeId : undefined
}

export function copyDiagnosticRunId(
  runId: string,
  clipboard: Pick<Clipboard, "writeText"> = navigator.clipboard
) {
  return clipboard.writeText(runId)
}

export function installRuntimeDiagnostics(
  target: EventTarget,
  store: Store = diagnostics
) {
  const onError = (event: Event) => {
    const message = (event as ErrorEvent).message
    if (message) store.report({ severity: "error", message, source: "앱" })
  }
  const onRejection = (event: Event) => {
    const reason: unknown = (event as PromiseRejectionEvent).reason
    store.report({
      severity: "error",
      message:
        reason instanceof Error
          ? reason.message
          : String(reason || "작업을 완료하지 못했습니다."),
      source: "앱",
    })
  }
  target.addEventListener("error", onError)
  target.addEventListener("unhandledrejection", onRejection)
  return () => {
    target.removeEventListener("error", onError)
    target.removeEventListener("unhandledrejection", onRejection)
  }
}
