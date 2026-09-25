export type DiagnosticSeverity = "warning" | "error"
export type Diagnostic = {
  id: string
  severity: DiagnosticSeverity
  message: string
  source: string
  timestamp: number
  runId?: string
  nodeId?: string
  connectionId?: string
  current?: boolean
  runCreatedAt?: number
  scope?: string
}
type Report = Omit<Diagnostic, "id" | "timestamp"> & { key?: string }
type DiagnosticStorage = Pick<Storage, "getItem" | "setItem">
type SuccessfulRun = { nodeId: string; runId: string; createdAt: number }
const storageKey = "giraf-diagnostics-v1"
type RecordData = Record<string, unknown>
function record(value: unknown): value is RecordData {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
}
function validDiagnostic(value: unknown): value is Diagnostic {
  return (
    record(value) &&
    typeof value.id === "string" &&
    ["warning", "error"].includes(String(value.severity)) &&
    typeof value.message === "string" &&
    typeof value.source === "string" &&
    typeof value.timestamp === "number" &&
    Number.isFinite(value.timestamp) &&
    ["runId", "nodeId", "scope"].every(
      (key) => value[key] === undefined || typeof value[key] === "string"
    ) &&
    (value.runCreatedAt === undefined ||
      (typeof value.runCreatedAt === "number" &&
        Number.isFinite(value.runCreatedAt)))
  )
}

// Persist unresolved records, explicit dismissals, and evidence of successful retries.
// In-memory stores remain available to tests without touching browser storage.
export function createDiagnosticStore(storage?: DiagnosticStorage) {
  let entries: Diagnostic[] = []
  let current: Diagnostic[] = []
  let currentDocument = ""
  let snapshot: Diagnostic[] = []
  let dismissed: Diagnostic[] = []
  const successful = new Map<string, SuccessfulRun>()
  const listeners = new Set<() => void>()
  try {
    const raw = storage?.getItem(storageKey)
    if (raw) {
      const saved: unknown = JSON.parse(raw)
      if (
        !record(saved) ||
        saved.version !== 1 ||
        !Array.isArray(saved.entries) ||
        !saved.entries.every(validDiagnostic) ||
        !Array.isArray(saved.dismissed) ||
        !saved.dismissed.every(validDiagnostic) ||
        !Array.isArray(saved.successful) ||
        !saved.successful.every(
          (run: unknown) =>
            record(run) &&
            typeof run.nodeId === "string" &&
            typeof run.runId === "string" &&
            typeof run.createdAt === "number" &&
            Number.isFinite(run.createdAt)
        )
      )
        throw new Error("Invalid saved diagnostics")
      entries = saved.entries
      dismissed = saved.dismissed
      for (const run of saved.successful as SuccessfulRun[])
        successful.set(run.nodeId, run)
    }
  } catch (error) {
    console.warn("오류 기록을 복원하지 못했습니다.", error)
  }
  snapshot = entries
  function publish() {
    snapshot = [...current, ...entries]
    try {
      storage?.setItem(
        storageKey,
        JSON.stringify({
          version: 1,
          entries,
          dismissed,
          successful: [...successful.values()],
        })
      )
    } catch (error) {
      console.warn("오류 기록을 저장하지 못했습니다.", error)
    }
    listeners.forEach((listener) => listener())
  }
  function isResolved(
    input: Pick<Diagnostic, "nodeId" | "runId" | "runCreatedAt">
  ) {
    const success = input.nodeId ? successful.get(input.nodeId) : undefined
    return (
      !!success &&
      !!input.runId &&
      input.runId !== success.runId &&
      input.runCreatedAt !== undefined &&
      input.runCreatedAt < success.createdAt
    )
  }
  return {
    getSnapshot: () => snapshot,
    getHistory: () => entries,
    currentForNode: (nodeId: string) => current.filter(entry => entry.nodeId === nodeId),
    currentForConnection: (connectionId: string) => current.filter(entry => entry.connectionId === connectionId),
    replaceCurrent(documentId: string, issues: {id: string; severity: DiagnosticSeverity; message: string; nodeId: string; connectionId?: string}[], nodeLabels: Record<string, string> = {}) {
      currentDocument = documentId
      const previous = new Map(current.map(entry => [entry.id, entry]))
      current = issues.map(issue => {
        const id = `current:${documentId}:${issue.id}`
        return { ...issue, id, source: nodeLabels[issue.nodeId] || issue.nodeId, current: true, timestamp: previous.get(id)?.timestamp ?? Date.now() }
      }).sort((a, b) => Number(b.severity === "error") - Number(a.severity === "error"))
      publish()
    },
    clearCurrent(documentId?: string) {
      if (documentId && documentId !== currentDocument) return
      if (!current.length) return
      current = []
      publish()
    },
    pruneCurrent(nodeIds: string[], connectionIds: string[]) {
      const nodes = new Set(nodeIds)
      const connections = new Set(connectionIds)
      const next = current.filter(entry => entry.nodeId && nodes.has(entry.nodeId) && (!entry.connectionId || connections.has(entry.connectionId)))
      if (next.length === current.length) return
      current = next
      publish()
    },
    isResolved,
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
      return [...entries, ...dismissed].some(
        (entry) =>
          entry.severity === severity &&
          entry.message === message.trim() &&
          (!nodeId || entry.nodeId === nodeId)
      )
    },
    resolveScope(
      scope: string,
      remaining: { severity: DiagnosticSeverity; message: string }[] = []
    ) {
      const keep = (entry: Diagnostic) =>
        entry.scope !== scope ||
        remaining.some(
          (item) =>
            item.severity === entry.severity &&
            item.message.trim() === entry.message
        )
      const next = entries.filter(keep)
      const kept = dismissed.filter(keep)
      if (next.length === entries.length && kept.length === dismissed.length)
        return
      entries = next
      dismissed = kept
      publish()
    },
    reconcileJob(context: ReturnType<typeof jobDiagnosticContext>) {
      let changed = false
      entries = entries.flatMap((entry) => {
        if (!context.runId || entry.runId !== context.runId) return [entry]
        const updated = {
          ...entry,
          nodeId: context.nodeId ?? entry.nodeId,
          runCreatedAt: context.runCreatedAt ?? entry.runCreatedAt,
        }
        if (isResolved(updated)) {
          changed = true
          return []
        }
        if (
          updated.nodeId !== entry.nodeId ||
          updated.runCreatedAt !== entry.runCreatedAt
        )
          changed = true
        return [updated]
      })
      if (changed) publish()
    },
    recordSuccess(run: SuccessfulRun) {
      const previous = successful.get(run.nodeId)
      if (previous && previous.createdAt >= run.createdAt) return
      successful.set(run.nodeId, run)
      entries = entries.filter((entry) => !isResolved(entry))
      publish()
    },
    report(input: Report) {
      const message = input.message.trim()
      if (!message || isResolved(input)) return
      const id =
        input.key ??
        JSON.stringify([
          input.severity,
          input.source,
          input.nodeId,
          input.runId,
          message,
        ])
      if (dismissed.some((entry) => entry.id === id)) return
      const previous = entries.find((entry) => entry.id === id)
      if (previous) {
        const updated = {
          ...previous,
          nodeId: previous.nodeId ?? input.nodeId,
          runId: previous.runId ?? input.runId,
          runCreatedAt: previous.runCreatedAt ?? input.runCreatedAt,
        }
        if (isResolved(updated)) {
          entries = entries.filter((entry) => entry.id !== id)
          publish()
        } else if (
          updated.nodeId !== previous.nodeId ||
          updated.runId !== previous.runId ||
          updated.runCreatedAt !== previous.runCreatedAt
        ) {
          entries = entries.map((entry) => (entry.id === id ? updated : entry))
          publish()
        }
        return
      }
      entries = [
        {
          severity: input.severity,
          source: input.source,
          nodeId: input.nodeId,
          runId: input.runId,
          runCreatedAt: input.runCreatedAt,
          scope: input.scope,
          message,
          id,
          timestamp: Date.now(),
        },
        ...entries,
      ]
      publish()
    },
    clear(severity?: DiagnosticSeverity) {
      dismissed = [
        ...dismissed,
        ...entries.filter((entry) => !severity || entry.severity === severity),
      ]
      entries = severity
        ? entries.filter((entry) => entry.severity !== severity)
        : []
      publish()
    },
  }
}
function browserStorage(): DiagnosticStorage | undefined {
  if (typeof window === "undefined") return undefined
  try {
    return window.localStorage
  } catch (error) {
    console.warn("오류 기록 저장소에 접근하지 못했습니다.", error)
    return undefined
  }
}
export const diagnostics = createDiagnosticStore(browserStorage())
type Store = ReturnType<typeof createDiagnosticStore>

export function jobDiagnosticContext(data: RecordData) {
  const manifest = record(data.manifest) ? data.manifest : undefined
  return {
    runId: typeof data.id === "string" ? data.id : undefined,
    nodeId:
      typeof data.instanceId === "string"
        ? data.instanceId
        : typeof manifest?.instanceId === "string"
          ? manifest.instanceId
          : undefined,
    runCreatedAt:
      typeof data.createdAt === "number" && Number.isFinite(data.createdAt)
        ? data.createdAt
        : undefined,
  }
}
export function requestDiagnosticScope(action: string, nodeId?: string) {
  return JSON.stringify(["request", action, nodeId])
}

export function collectResponseDiagnostics(
  action: string,
  data: unknown,
  store: Store = diagnostics,
  context: { nodeId?: string; ok?: boolean } = {}
) {
  const route = action.split("?")[0]
  if (Array.isArray(data)) {
    if (route === "jobs") data.forEach((job) => collectJob(job, store))
    return
  }
  if (!record(data)) return
  const source = `요청: ${route}`
  const scope = JSON.stringify(["response", action, context.nodeId])
  const errors = strings(data.errors)
  if (context.ok !== false && !data.error)
    store.resolveScope(scope, [
      ...errors.map((message) => ({ severity: "error" as const, message })),
      ...strings(data.warnings).map((message) => ({
        severity: "warning" as const,
        message,
      })),
    ])
  for (const message of strings(data.warnings))
    store.report({
      severity: "warning",
      message,
      source,
      nodeId: context.nodeId,
      scope,
    })
  for (const message of errors)
    store.report({
      severity: "error",
      message,
      source,
      nodeId: context.nodeId,
      scope,
    })
  if (Array.isArray(data.files))
    for (const file of data.files) {
      if (!record(file) || typeof file.id !== "string") continue
      const fileScope = `file:${file.id}`
      if (typeof file.error === "string" && file.error.trim())
        store.report({
          severity: "error",
          message: file.error,
          source: String(file.label || file.id),
          scope: fileScope,
          key: `${fileScope}:${file.error}`,
        })
      else if (context.ok !== false) store.resolveScope(fileScope)
    }
  if (["job", "task-run", "run"].includes(route)) collectJob(data, store)
  if (route.startsWith("workflow") && typeof data.state === "string") {
    const jobs = [
      ...(Array.isArray(data.jobs) ? data.jobs : []),
      data.currentJob,
    ].filter(record)
    jobs.forEach((job) => collectJob(job, store))
    if (
      data.state === "failed" &&
      !jobs.some((job) => job.state === "failed")
    ) {
      store.report({
        severity: "error",
        message: String(data.message || "워크플로우 실행 실패"),
        source: "워크플로우",
        nodeId:
          typeof data.currentTask === "string" ? data.currentTask : undefined,
        runId: `workflow:${data.id}`,
        runCreatedAt:
          typeof data.updatedAt === "number" ? data.updatedAt : undefined,
        key: `workflow:${data.id}:failed`,
      })
    }
  }
}
function collectJob(data: unknown, store: Store) {
  if (
    !record(data) ||
    typeof data.id !== "string" ||
    typeof data.state !== "string"
  )
    return
  const context = jobDiagnosticContext(data)
  if (
    data.state === "completed" &&
    context.nodeId &&
    context.runCreatedAt !== undefined
  )
    store.recordSuccess({
      nodeId: context.nodeId,
      runId: data.id,
      createdAt: context.runCreatedAt,
    })
  store.reconcileJob(context)
  if (store.isResolved(context)) return
  const source = String(data.name || data.task || "작업")
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
    const severity = ["warning", "warn", "경고"].includes(
      (match[1] || match[2]).toLowerCase()
    )
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
