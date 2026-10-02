import { useCallback, useEffect, useMemo, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useStore } from "zustand"
import { createEditorStore } from "@/lib/edit-history"
import {
  workflowActive,
  initialPreferences,
  type LinkDialog,
} from "@/features/workbench/types"
import { type ExecutionStatus } from "@/components/workbench-toolbar"
import {
  type Catalog,
  type Preferences,
  type Workspace,
  type Frame,
  api,
  type Job,
  type Slot,
} from "@/lib/workbench"
import {
  type TaskMap,
  type Instance,
  disconnect,
  type Source,
  emptyMap,
} from "@/lib/task-map"
import { resolveDiagnosticNode, type Diagnostic } from "@/lib/diagnostics"
import { activeJob, apiQueryOptions } from "@/lib/queries"
import {
  resolveExecutionStatus,
  type ExecutionReference,
} from "@/lib/execution-status"
import { toast } from "@/components/ui/toast"
import { useJobDiagnostics } from "@/hooks/use-job-diagnostics"
import type { PickerRequest } from "@/features/file-picker/FilePicker"
import { useLayout } from "@/features/workbench/layout-store"
import { revealPanel } from "@/features/dock/store"
import { useAssetViewer } from "@/features/workbench/hooks/useAssetViewer"
import { useWorkflowDocuments } from "@/features/workbench/hooks/useWorkflowDocuments"
import { useWorkbenchBootstrap } from "@/features/workbench/hooks/useWorkbenchBootstrap"
import { useTaskEditing } from "@/features/workbench/hooks/useTaskEditing"
import { useTaskExecution } from "@/features/workbench/hooks/useTaskExecution"
import { useWorkflowExecution } from "@/features/workbench/hooks/useWorkflowExecution"
import { useJobPolling } from "@/features/workbench/hooks/useJobPolling"
import { useDocumentPersistence } from "@/features/workbench/hooks/useDocumentPersistence"
import { useWorkflowDiagnostics } from "@/features/workbench/hooks/useWorkflowDiagnostics"

/**
 * The workbench's documents, jobs and actions, independent of where each
 * panel is placed. Panels read it through useWorkbench().
 */
export function useWorkbenchController() {
  const queryClient = useQueryClient()
  const layout = useLayout.getState
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [workspace, setWorkspace] = useState<Workspace>({
      folder: "",
      files: [],
      sets: [],
    }),
    [prefs, setPrefs] = useState<Preferences>(initialPreferences),
    [cache, setCache] = useState<Record<string, Frame>>({}),
    [jobs, setJobs] = useState<Job[]>([])
  const [editor] = useState(() => createEditorStore(emptyMap()))
  const map = useStore(editor.store, editor.selectMap)
  const temporalState = useStore(editor.store.temporal)
  const currentEditLabel = useStore(editor.store, (state) => state.label)
  const editHistory = useMemo(
    () => editor.history(temporalState, currentEditLabel),
    [editor, temporalState, currentEditLabel]
  )
  const setMap = editor.reset
  const [documentBusy, setDocumentBusy] = useState(false)
  const [mapSearch, setMapSearch] = useState("")
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadFailure, setLoadError] = useState(false)
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [, setSaveState] = useState("저장됨"),
    [picker, setPicker] = useState<PickerRequest | null>(null),
    [addOpen, setAddOpen] = useState(false),
    [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [linking, setLinking] = useState<LinkDialog | null>(null)
  const [selectedJob, setSelectedJob] = useState("")
  useJobDiagnostics(jobs)
  const [lastExecution, setLastExecution] = useState<ExecutionReference>()
  const {
    replacePreferences,
    queueSave,
    prefsRef,
    autosave,
    finishEdit,
    saveTaskDefaults,
  } = useDocumentPersistence({
    prefs,
    setPrefs,
    setSaveState,
    setError,
    editor,
  })
  const { diagnosticController, diagnosticFailure } = useWorkflowDiagnostics({
    map,
    workspace,
    prefs,
    ready,
    catalog,
  })
  const remember = useCallback(
    (rows: Frame[]) =>
      setCache((old) => ({
        ...old,
        ...Object.fromEntries(rows.map((r) => [r.id, { ...old[r.id], ...r }])),
      })),
    []
  )
  const refresh = useCallback(async () => {
    const options = apiQueryOptions<Workspace>("workspace")
    await queryClient.cancelQueries({ queryKey: options.queryKey })
    const w = await queryClient.fetchQuery(options)
    setWorkspace(w)
    remember(w.files)
  }, [remember, queryClient])
  const { loadError } = useWorkbenchBootstrap({
    loadAttempt,
    ready,
    loadFailure,
    setCatalog,
    setSaveState,
    replacePreferences,
    setMap,
    queueSave,
    setWorkspace,
    setJobs,
    remember,
    setReady,
  })
  const update = useCallback(
    (fn: (m: TaskMap) => TaskMap, label?: string) => {
      if (editor.update(fn, label)) queueSave()
    },
    [editor, queueSave]
  )
  const publishJob = useCallback(
    (instanceId: string, job: Job, catalog?: Catalog) => {
      if (editor.publishRun(instanceId, job, catalog)) queueSave()
    },
    [editor, queueSave]
  )
  const { applyDocument, saveDocument, changeDocument, exportDocument } =
    useWorkflowDocuments({
      editor,
      prefsRef,
      replacePreferences,
      queueSave,
      autosave,
      catalog,
      jobs,
      diagnosticController,
      workspace,
      setMap,
      setSaveState,
      setLastExecution,
      setSelectedFiles,
      setLayoutRevision,
      documentBusy,
      setDocumentBusy,
    })
  const {
    workflowStarting,
    workflowName,
    workflow,
    setWorkflow,
    runWorkflow,
    cancelWorkflow,
    workflowMutation,
  } = useWorkflowExecution({
    queryClient,
    ready,
    setLastExecution,
    setJobs,
    remember,
    publishJob,
    catalog,
    setSelectedJob,
    map,
    prefs,
    setError,
    workspace,
  })
  const {
    setTaskError,
    taskError,
    busy,
    checking,
    plan,
    preparingName,
    run,
    setPlan,
    start,
    pendingPayload,
    daoedit,
    setDaoedit,
  } = useTaskExecution({
    setLastExecution,
    setJobs,
    setSelectedJob,
    publishJob,
    map,
    catalog,
    workflow,
    workspace,
  })
  const restoreHistory = useCallback(
    (type: "undo" | "redo", steps = 1) => {
      if (!editor[type](steps)) return
      queueSave()
      setTaskError("")
      setLayoutRevision((revision) => revision + 1)
    },
    [editor, queueSave, setTaskError]
  )
  useEffect(() => {
    if (error) {
      toast.add({ title: error, type: "error" })
      setError("")
    }
  }, [error])
  useEffect(() => {
    if (!taskError) return
    toast.add({ title: taskError, type: "error" })
    setTaskError("")
  }, [taskError, setTaskError])
  let preparing: ExecutionStatus | undefined
  if (workflowStarting) {
    preparing = { name: workflowName, label: "실행 준비 중", state: "running" }
  } else if (busy || checking || plan) {
    preparing = {
      name: preparingName,
      label: plan && !busy ? "실행 확인 대기" : "실행 준비 중",
      state: plan && !busy ? "waiting" : "running",
    }
  }
  const currentWorkflowTask = map.tasks.find(
    (t) => t.id === workflow?.currentTask
  )
  const executionStatus = resolveExecutionStatus({
    preparing,
    workflow: workflow && {
      ...workflow,
      name: workflowName,
      currentTaskName:
        currentWorkflowTask?.label ||
        currentWorkflowTask?.task ||
        workflow.currentJob?.name ||
        "",
    },
    jobs,
    lastExecution,
  })
  const running = jobs.some(activeJob)
  useJobPolling({
    jobs,
    selectedJob,
    ready,
    setJobs,
    remember,
    publishJob,
    refresh,
    setError,
  })
  const rows = useMemo(() => Object.values(cache), [cache]),
    task = map.tasks.find((t) => t.id === map.view.selected)
  const currentJob =
    jobs.find((j) => j.id === selectedJob) ||
    jobs.find((j) => j.manifest?.instanceId === task?.id)
  const taskJob = jobs.find((j) => j.manifest?.instanceId === task?.id)
  const assetViewer = useAssetViewer({
    cache,
    task,
    catalog,
    prefs,
    update,
    taskJob,
    map,
    setSelectedJob,
  })
  const { asset, setAsset } = assetViewer
  function pick(slot: Slot, ids: string[], apply: (ids: string[]) => void) {
    setPicker({ slot, initial: ids, apply })
  }
  function folder() {
    setPicker({
      slot: {
        name: "folder",
        label: "작업 폴더",
        multiple: false,
        kind: "image",
      },
      initial: [],
      apply: () => {},
      folderOnly: true,
      applyFolder: async (path) => {
        const previousFolder = workspace.folder
        let moved = false
        setDocumentBusy(true)
        try {
          editor.endEdit()
          await autosave.flush()
          await api("folder", { path })
          moved = true
          await refresh()
          applyDocument(await api<Preferences>("task-preferences"))
        } catch (e) {
          if (moved) {
            try {
              await api("folder", { path: previousFolder })
              await refresh()
            } catch {
              setReady(false)
              setLoadError(true)
            }
          }
          setError((e as Error).message)
        } finally {
          setDocumentBusy(false)
        }
      },
    })
  }
  function retryLoad() {
    setLoadError(false)
    setLoadAttempt((v) => v + 1)
  }
  function link(target = map.view.selected, source?: Source) {
    if (source && source.kind !== "files" && source.taskId === target)
      target = map.tasks.find((t) => t.id !== source.taskId)?.id || ""
    const t = map.tasks.find((t) => t.id === target)
    const s = catalog?.tasks.find((s) => s.name === t?.task)
    setLinking({
      target,
      role: s?.inputs[0]?.name || "",
      source,
      sourceKey: source ? "provided" : "",
    })
  }
  /** Selects a node and brings it into view on the canvas. */
  function selectNode(id: string) {
    update((m) => ({ ...m, view: { ...m.view, selected: id } }))
    layout().clearInputRequest()
    layout().revealNode(id)
  }
  function navigateToDiagnostic(entry: Diagnostic) {
    const id = resolveDiagnosticNode(entry, map)
    if (!id) return
    setMapSearch("")
    selectNode(id)
    revealPanel("inspector")
    if (entry.connectionId) layout().revealConnection(entry.connectionId)
  }
  function viewLog(id: string) {
    setSelectedJob(id)
    layout().viewLog(id)
  }
  function setBackend(backend: string) {
    if (task) edit((t) => ({ ...t, backend }))
    else {
      replacePreferences({ ...prefsRef.current, backend })
      queueSave()
    }
  }
  async function refreshCatalog() {
    setCatalog(await api<Catalog>("catalog?refresh=1"))
  }
  async function deleteLibrary(kind: "files" | "jobs", ids: string[]) {
    const removed = await api<{
      fileIds: string[]
      jobIds: string[]
      failedIds: string[]
    }>(`delete-${kind}`, { ids })
    const fileIds = new Set(removed.fileIds)
    const jobIds = new Set(removed.jobIds)
    setSelectedFiles((previous) => previous.filter((id) => !fileIds.has(id)))
    setCache((previous) =>
      Object.fromEntries(
        Object.entries(previous).filter(([id]) => !fileIds.has(id))
      )
    )
    setWorkspace((previous) => ({
      ...previous,
      files: previous.files.filter((file) => !fileIds.has(file.id)),
    }))
    setJobs((previous) =>
      previous
        .filter((job) => !jobIds.has(job.id))
        .map((job) => ({
          ...job,
          products: job.products.filter((file) => !fileIds.has(file.id)),
        }))
    )
    editor.removeLibrary(fileIds, jobIds)
    queueSave()
    if (asset && fileIds.has(asset.row.id)) setAsset(null)
    if (jobIds.has(selectedJob)) {
      setSelectedJob("")
      layout().clearLog()
    }
    setWorkflow((previous) =>
      previous
        ? {
            ...previous,
            jobs: previous.jobs.filter((job) => !jobIds.has(job.id)),
            currentJob:
              previous.currentJob && jobIds.has(previous.currentJob.id)
                ? null
                : previous.currentJob,
          }
        : null
    )
    // The deletion succeeded even if refreshing the remaining library fails.
    try {
      await refresh()
    } catch {
      setError(
        "휴지통으로 이동했습니다. 남은 목록을 불러오지 못해 새로고침이 필요합니다."
      )
    }
    if (removed.failedIds.length)
      throw new Error("일부 항목을 휴지통으로 옮기지 못했습니다.")
  }
  const taskEditing = useTaskEditing({
    catalog,
    prefs,
    map,
    update,
    rows,
    task,
  })
  const { layoutBusy } = taskEditing
  function add(name: string, ids: string[] = selectedFiles) {
    if (!taskEditing.add(name, ids)) return
    setAddOpen(false)
    if (ids === selectedFiles) setSelectedFiles([])
    layout().setInspectorTab("input")
    revealPanel("inspector")
    setTaskError("")
  }
  function edit(fn: (task: Instance) => Instance, id = task?.id) {
    if (!id) return
    setTaskError("")
    taskEditing.edit(fn, id)
  }
  function remove(id: string) {
    taskEditing.remove(id)
    setTaskError("")
  }
  function duplicate(id: string) {
    taskEditing.duplicate(id)
    setTaskError("")
  }
  function removeLink(id: string) {
    update((m) => disconnect(m, id), "연결 삭제")
  }
  async function autoLayout(straight = false) {
    try {
      if (await taskEditing.autoLayout(straight))
        setLayoutRevision((revision) => revision + 1)
    } catch {
      toast.add({
        title: "자동 배치에 실패했습니다. 다시 시도해 주세요.",
        type: "error",
      })
    }
  }
  const workflowBusy = workflowActive(workflow)
  /** Documents and edit history are locked while anything runs. */
  const locked =
    !ready ||
    documentBusy ||
    workflowStarting ||
    workflowBusy ||
    busy ||
    running

  return {
    // Documents and library
    catalog,
    workspace,
    prefs,
    prefsRef,
    rows,
    remember,
    refresh,
    refreshCatalog,
    ready,
    loadError,
    retryLoad,
    documentBusy,
    saveDocument,
    changeDocument,
    exportDocument,
    folder,
    selectedFiles,
    setSelectedFiles,
    deleteLibrary,
    // Workflow editing
    editor,
    map,
    task,
    update,
    finishEdit,
    editHistory,
    restoreHistory,
    diagnosticFailure,
    navigateToDiagnostic,
    selectNode,
    mapSearch,
    setMapSearch,
    layoutRevision,
    layoutBusy,
    autoLayout,
    add,
    edit,
    remove,
    duplicate,
    removeLink,
    link,
    linking,
    setLinking,
    pick,
    picker,
    setPicker,
    addOpen,
    setAddOpen,
    setBackend,
    saveTaskDefaults,
    // Execution
    jobs,
    currentJob,
    taskJob,
    setSelectedJob,
    viewLog,
    workflow,
    workflowBusy,
    workflowStarting,
    workflowMutation,
    runWorkflow,
    cancelWorkflow,
    executionStatus,
    running,
    locked,
    busy,
    checking,
    run,
    start,
    plan,
    setPlan,
    pendingPayload,
    daoedit,
    setDaoedit,
    taskError,
    setTaskError,
    error,
    setError,
    // Result viewer
    assetViewer,
  }
}

export type Workbench = ReturnType<typeof useWorkbenchController>
