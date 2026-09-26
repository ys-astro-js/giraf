import { useMutation, useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query"
import { apiQueryOptions, jobQueryOptions, activeJob } from "@/lib/queries"
import { useJobDiagnostics } from "@/hooks/use-job-diagnostics"
import { createEditorStore } from "@/lib/edit-history"
import { createDocumentAutosave } from "@/lib/document-autosave"
import { useStore } from "zustand"
import { EditHistoryControls } from "@/components/edit-history-controls"
import { workflowDocument } from "@/lib/workflow-document"
import { nodeLayout } from "@/lib/node-interaction"
import { DiagnosticsButton } from "@/components/diagnostics-button"
import { diagnostics, resolveDiagnosticNode } from "@/lib/diagnostics"
import { createWorkflowDiagnosticsController } from "@/lib/live-diagnostics"
import { WorkflowSelector, type WorkflowAction } from "@/components/workflow-selector"
import { resolveExecutionStatus, type ExecutionReference } from "@/lib/execution-status"
import { readPanelLayout } from "@/lib/panel-layout"
import { WorkbenchToolbar, type ExecutionStatus } from "@/components/workbench-toolbar"
import { autoLayoutMap } from "@/lib/subflow"
import {updateOutputPort,removeOutputPort} from "@/lib/output-ports"
import {connectInputPort} from "@/lib/workflow-flow"
import {parsePort} from "@/lib/calibration-ports"
import { LibrarySidebar } from "@/components/library-sidebar"
import { RunHistory } from "@/components/run-history"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FolderOpen,
  Columns2,
  Image,
  TableProperties,
  Link2,
  ArrowLeft,
  Moon,
  Sun,
} from "lucide-react"
import { useIsMobile } from "@/hooks/use-mobile"
import { WorkbenchShell } from "@/components/workbench-shell"
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { toast, Toaster } from "@/components/ui/toast"
import { ButtonGroup } from "@/components/ui/button-group"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Skeleton } from "@/components/ui/skeleton"
import { useTheme } from "@/components/theme-provider"
import { FilePicker, type PickerRequest } from "@/components/file-picker"
import { RevealFile, ViewerToolButton } from "@/components/viewer-controls"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ViewerWorkspace } from "@/components/image-viewer"
import {
  Choice,
  Blank,
  Failure,
} from "@/components/workbench-controls"
import { TaskInspector, assigned } from "@/components/task-inspector"
import { subflowRequest, moveTaskToSubflow } from "@/lib/subflow"
import { TaskMapView } from "@/components/task-map-view"
import {
  api,
  defaults,
  type Catalog,
  type Preferences,
  type Frame,
  type Workspace,
  type Job,
  type Slot,
} from "@/lib/workbench"
import {
  emptyMap,
  removeTask,
  reconcileRuns,
  addTask,
  duplicateTask,
  makeInstance,
  connect,
  replaceRoleInputs,
  workflowRequest,
  workflowDiagnosticRequest,
  workflowDiagnosticSignature,
  disconnect,
  payloadFor,
  migrateMap,
  connectionRoles,
  type TaskMap,
  type Source,
  type Instance,
} from "@/lib/task-map"

type LinkDialog = {
  target: string
  role: string
  source?: Source
  sourceKey: string
}
type Origin = {
  taskId: string
  role: string
  sourceId: string
  editorId: string
}
type Plan = {
  preview: { inputs: string[]; output: string }[]
  filePlan: {
    token: string
    destructive: boolean
    description: string
    targets: { path: string }[]
    backup: boolean
  }
  effective: unknown
}
type WorkflowRun = {
  id: string
  state: string
  message: string
  total: number
  done: number
  currentTask: string
  jobs: (Job & { instanceId: string })[]
  currentJob: Job | null
  plan: Plan["filePlan"] | null
}
const workflowActive = (w: WorkflowRun | null) =>
  !!w && ["running", "waiting", "confirmation", "cancelling"].includes(w.state)
const initial: Preferences = {
  drafts: {},
  backend: "cl",
  mapping: {
    imagetyp: "IMAGETYP",
    exptime: "EXPTIME",
    darktime: "DARKTIME",
    subset: "FILTER",
  },
  instrument: [],
  packageValues: {},
}
const active = activeJob
const workflowOptions = apiQueryOptions<WorkflowRun | null>("workflow")
function combineJobs(results: UseQueryResult<Job>[]) {
  return {
    jobs: results.flatMap(result => result.data ? [result.data] : []),
    error: results.find(result => result.error)?.error,
  }
}

function App() {
  const queryClient = useQueryClient()
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [workspace, setWorkspace] = useState<Workspace>({
      folder: "",
      files: [],
      sets: [],
    }),
    [prefs, setPrefs] = useState<Preferences>(initial),
    [cache, setCache] = useState<Record<string, Frame>>({}),
    [jobs, setJobs] = useState<Job[]>([])
  const [editor] = useState(() => createEditorStore(emptyMap()))
  const map = useStore(editor.store, editor.selectMap)
  const temporalState = useStore(editor.store.temporal)
  const currentEditLabel = useStore(editor.store, state => state.label)
  const editHistory = useMemo(() => editor.history(temporalState, currentEditLabel), [editor, temporalState, currentEditLabel])
  const setMap = editor.reset
  const [documentBusy, setDocumentBusy] = useState(false)
  const [diagnosticFailure, setDiagnosticFailure] = useState("")
  const diagnosticController = useRef<ReturnType<typeof createWorkflowDiagnosticsController> | null>(null)
  const [mapSearch, setMapSearch] = useState("")
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [revealNode, setRevealNode] = useState<{ id: string; revision: number }>()
  const [revealConnection, setRevealConnection] = useState<{ id: string; revision: number }>()
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadFailure, setLoadError] = useState(false)
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [, setSaveState] = useState("저장됨"),
    [picker, setPicker] = useState<PickerRequest | null>(null),
    [addOpen, setAddOpen] = useState(false),
    [query, setQuery] = useState(""),
    [libraryOpen, setLibraryOpen] = useState(
      () => readPanelLayout().libraryOpen ?? (typeof window !== "undefined" && window.innerWidth >= 1100)
    ),
    [mobilePanel, setMobilePanel] = useState("map"),
    [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [linking, setLinking] = useState<LinkDialog | null>(null),
    [asset, setAsset] = useState<{
      row: Frame
      role?: string
      taskId?: string
    } | null>(null),
    [assetView, setAssetView] = useState("image"),
    [assetText, setAssetText] = useState(""),
    [headers, setHeaders] = useState<
      { key: string; value: string; comment: string; hdu: number }[]
    >([]),
    [compare, setCompare] = useState<string[]>([]),
    [origin, setOrigin] = useState<Origin | null>(null)
  const [selectedJob, setSelectedJob] = useState(""),
    [busy, setBusy] = useState(false),
    [taskError, setTaskError] = useState(""),
    [plan, setPlan] = useState<Plan | null>(null),
    [pendingPayload, setPendingPayload] = useState<unknown>(null),
    [response, setResponse] = useState("")
  const [trayOpen, setTrayOpen] = useState(false)
  const [logRequest, setLogRequest] = useState<{id: string; revision: number} | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(() => readPanelLayout().inspectorOpen ?? true)
  const [inspectorTab, setInspectorTab] = useState("info")
  const [inputRequest, setInputRequest] = useState<{ taskId: string; role: string; sequence: number } | null>(null)
  const isMobile = useIsMobile()
  const settingsVisible = isMobile ? mobilePanel === "detail" : inspectorOpen
  useJobDiagnostics(jobs)
  const workflowMutation = useMutation({
    mutationFn: ({ action, payload }: { action: string; payload: unknown }) => api<WorkflowRun>(action, payload),
    onMutate: () => queryClient.cancelQueries({ queryKey: workflowOptions.queryKey }),
    onSuccess: value => queryClient.setQueryData(workflowOptions.queryKey, value),
  })
  const workflowQuery = useQuery({
    ...workflowOptions,
    enabled: ready && !workflowMutation.isPending,
    refetchInterval: 1200,
    refetchIntervalInBackground: true,
  })
  const workflow = workflowQuery.data ?? null
  const setWorkflow = useCallback((value: WorkflowRun | null | ((previous: WorkflowRun | null) => WorkflowRun | null)) => {
    queryClient.setQueryData(workflowOptions.queryKey, previous =>
      typeof value === "function" ? value(previous ?? null) : value)
  }, [queryClient])
  const [workflowStarting, setWorkflowStarting] = useState(false)
  const workflowLock = useRef(false)
  const [lastExecution, setLastExecution] = useState<ExecutionReference>()
  const [preparingName, setPreparingName] = useState("")
  const [workflowName, setWorkflowName] = useState("워크플로우")
  const [checking, setChecking] = useState(false)
  const runLock = useRef(false)
  const prefsRef = useRef(prefs)
  const replacePreferences = useCallback((value: Preferences) => {
    prefsRef.current = value
    setPrefs(value)
  }, [])
  const [autosave] = useState(() => createDocumentAutosave<Preferences>({
    save: async value => { await api("task-preferences", value) },
    writeRecovery: value => localStorage.setItem("giraf-pending-draft", JSON.stringify(value)),
    clearRecovery: () => localStorage.removeItem("giraf-pending-draft"),
    onSaved: () => setSaveState("저장됨"),
    onError: error => { setSaveState("저장 실패"); setError((error as Error).message) },
  }))
  const queueSave = useCallback(() => {
    setSaveState("저장 중")
    autosave.schedule({ ...prefsRef.current, taskMap: editor.getMap() })
  }, [autosave, editor])
  const finishEdit = useCallback(() => {
    editor.endEdit()
    void autosave.flush().catch(() => {})
  }, [autosave, editor])
  useEffect(() => {
    const flushRecovery = () => autosave.flushRecovery()
    const hide = () => { if (document.visibilityState === "hidden") flushRecovery() }
    window.addEventListener("pagehide", flushRecovery)
    document.addEventListener("visibilitychange", hide)
    return () => {
      window.removeEventListener("pagehide", flushRecovery)
      document.removeEventListener("visibilitychange", hide)
      autosave.dispose()
    }
  }, [autosave])
  const diagnosticSignature = workflowDiagnosticSignature(map, workspace.folder)
  const documentId = prefs._document?.path || "현재 문서"
  useEffect(() => {
    const controller = createWorkflowDiagnosticsController(diagnostics)
    diagnosticController.current = controller
    const unsubscribe = controller.subscribeFailure(() => setDiagnosticFailure(controller.getFailure()))
    return () => {
      unsubscribe()
      controller.dispose()
      diagnosticController.current = null
    }
  }, [])
  useEffect(() => {
    if (!ready || !catalog) return
    diagnosticController.current?.change(documentId, workflowDiagnosticRequest(map, catalog, workspace.folder))
  // The signature excludes position, selection, zoom and other view changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticSignature, documentId, ready, catalog, diagnosticController])
  useEffect(() => {
    if (!ready) return
    const checkVisible = () => {
      if (!document.hidden) diagnosticController.current?.recheck()
    }
    const timer = setInterval(checkVisible, 3000)
    document.addEventListener("visibilitychange", checkVisible)
    window.addEventListener("focus", checkVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", checkVisible)
      window.removeEventListener("focus", checkVisible)
    }
  }, [ready, diagnosticController])
  const { theme, setTheme } = useTheme()
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
  // Hydrate the editable document once; background queries must never reset edits.
  const bootstrap = useQuery({
    queryKey: ["workbench-bootstrap", loadAttempt],
    enabled: !ready,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: ({ signal }) => Promise.all([
      api<Catalog>("catalog", undefined, signal),
      api<Preferences & { files: Frame[] }>("task-preferences", undefined, signal),
      api<Workspace>("workspace", undefined, signal),
      api<Job[]>("jobs", undefined, signal),
    ]),
  })
  const loadError = loadFailure || bootstrap.isError
  useEffect(() => {
    if (ready || !bootstrap.data || loadError) return
    const [c, p, w, j] = bootstrap.data
    let recovered = p
    try {
      const pending = localStorage.getItem("giraf-pending-draft")
      if (pending) {
        const recovery = JSON.parse(pending)
        if (recovery._document?.path === p._document?.path) {
          recovered = recovery
        }
      }
    } catch {
      /* Ignore a malformed browser recovery copy. */
    }
    const pref = {
      ...initial,
      ...recovered,
      drafts: recovered.drafts || {},
      packageValues: { ...defaults(c.ccdred), ...recovered.packageValues },
    }
    // The server snapshot initializes the independently editable document once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCatalog(c)
    setSaveState(pref._document?.saved ? "저장됨" : "작업을 추가하면 자동 저장됩니다")
    replacePreferences(pref)
    setMap(reconcileRuns(migrateMap(pref, c), j))
    if (recovered !== p) queueSave()
    setWorkspace(w)
    setJobs(j)
    remember([
      ...(p.files || []),
      ...w.files,
      ...j.flatMap((j) => j.products || []),
    ])
    setReady(true)
  }, [bootstrap.data, ready, loadError, remember, setMap, replacePreferences, queueSave])
  const update = useCallback((fn: (m: TaskMap) => TaskMap, label?: string) => {
    if (editor.update(fn, label)) queueSave()
  }, [editor, queueSave])
  const publishJob = useCallback((instanceId: string, job: Job, catalog?: Catalog) => {
    if (editor.publishRun(instanceId, job, catalog)) queueSave()
  }, [editor, queueSave])
  const restoreHistory = useCallback((type: "undo" | "redo", steps = 1) => {
    if (!editor[type](steps)) return
    queueSave()
    setTaskError("")
    setLayoutRevision(revision => revision + 1)
  }, [editor, queueSave])
  async function saveDocument(name?: string) {
    editor.endEdit()
    const current = prefsRef.current
    if (name !== undefined && current._document) replacePreferences({ ...current, _document: { ...current._document, name } })
    queueSave()
    await autosave.flush()
  }
  function applyDocument(value: Preferences) {
    if (!catalog) return
    autosave.reset()
    const next = {...initial, ...value, drafts: value.drafts || {}, packageValues: {...defaults(catalog.ccdred), ...value.packageValues}}
    const nextMap = reconcileRuns(migrateMap(next, catalog), jobs)
    diagnosticController.current?.change(next._document?.path || "현재 문서", workflowDiagnosticRequest(nextMap, catalog, workspace.folder), true)
    replacePreferences(next)
    setMap(nextMap)
    setSaveState(value._document?.saved ? "저장됨" : "작업을 추가하면 자동 저장됩니다")
    setLastExecution(undefined)
    setSelectedFiles([])
    setLayoutRevision(revision => revision + 1)
  }
  async function changeDocument(action: WorkflowAction) {
    if (documentBusy) return
    setDocumentBusy(true)
    try {
      editor.endEdit()
      await autosave.flush()
      applyDocument(await api<Preferences>("workflow-documents", action))
    } finally { setDocumentBusy(false) }
  }
  function exportDocument() {
    const exported = workflowDocument(prefsRef.current, editor.getMap())
    const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], {type: "application/json"}))
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${exported.name.replace(/[\\/:*?"<>|]/g, "_")}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  const publishedWorkflowJobs = useRef(new Map<string, Job>())
  useEffect(() => {
    if (!ready || !workflow) return
    if (workflowActive(workflow)) {
      // Publish the external run into the editor's execution history.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastExecution(current => current?.kind === "workflow" && current.id === workflow.id
        ? current : {kind: "workflow", id: workflow.id})
    }
    const current = [...workflow.jobs, ...(workflow.currentJob ? [workflow.currentJob] : [])]
    if (current.some(job => publishedWorkflowJobs.current.get(job.id) !== job)) {
      const incoming = current.filter(job => publishedWorkflowJobs.current.get(job.id) !== job)
      publishedWorkflowJobs.current = new Map(current.map(job => [job.id, job]))
      setJobs(old => [...current, ...old.filter(job => !current.some(next => next.id === job.id))]
        .filter((job, index, all) => all.findIndex(next => next.id === job.id) === index))
      remember(current.flatMap(job => job.products || []))
      for (const job of incoming) {
        if (job.manifest?.instanceId) publishJob(job.manifest.instanceId, job, catalog ?? undefined)
      }
    }
    if (workflow.currentJob && workflow.state === "waiting") {
      setSelectedJob(workflow.currentJob.id)
      setTrayOpen(true)
    }
  }, [ready, workflow, catalog, remember, publishJob])
  useEffect(() => {
    if (workflowQuery.error) toast.add({ title: workflowQuery.error.message, type: "error" })
  }, [workflowQuery.error])
  async function runWorkflow(subflowId?: string) {
    if (!catalog || workflowLock.current || workflowActive(workflow)) return
    workflowLock.current = true
    setLastExecution(undefined)
    setWorkflowName(subflowId ? map.subflows?.find((s) => s.id === subflowId)?.name || "워크플로우" : prefs._document?.name || "워크플로우")
    setWorkflowStarting(true)
    setError("")
    try {
      const w = await workflowMutation.mutateAsync({
        action: "workflow-run",
        payload: subflowId ? subflowRequest(map, catalog, workspace.folder, subflowId) : workflowRequest(map, catalog, workspace.folder),
      })
      setLastExecution({kind: "workflow", id: w.id})
    } catch (e) {
      setError((e as Error).message)
    } finally {
      workflowLock.current = false
      setWorkflowStarting(false)
    }
  }
  async function cancelWorkflow() {
    try {
      await workflowMutation.mutateAsync({ action: "workflow-cancel", payload: {} })
    } catch (e) {
      setError((e as Error).message)
    }
  }
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
  }, [taskError])
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
  const currentWorkflowTask = map.tasks.find((t) => t.id === workflow?.currentTask)
  const executionStatus = resolveExecutionStatus({
    preparing,
    workflow: workflow && {
      ...workflow,
      name: workflowName,
      currentTaskName: currentWorkflowTask?.label || currentWorkflowTask?.task || workflow.currentJob?.name || "",
    },
    jobs,
    lastExecution,
  })
  const running = jobs.some(active)
  const observedJobs = useMemo(() => [...new Set([
    ...jobs.filter(active).map(job => job.id),
    ...(selectedJob ? [selectedJob] : []),
  ])], [jobs, selectedJob])
  const jobResults = useQueries({
    queries: observedJobs.map(id => ({ ...jobQueryOptions(id), enabled: ready })),
    combine: combineJobs,
  })
  const appliedJobs = useRef(new Map<string, Job>())
  useEffect(() => {
    const incoming = jobResults.jobs.filter(job => appliedJobs.current.get(job.id) !== job)
    if (!incoming.length) return
    // Opening historical logs must not publish that run over the current graph.
    const tracked = incoming.filter(job => {
      const previous = appliedJobs.current.get(job.id) || jobs.find(current => current.id === job.id)
      return active(job) || (previous && active(previous))
    })
    const completed = tracked.some(job => !active(job))
    incoming.forEach(job => appliedJobs.current.set(job.id, job))
    setJobs(old => old.map(job => incoming.find(next => next.id === job.id) || job))
    remember(incoming.flatMap(job => job.products || []))
    for (const job of tracked) if (job.manifest?.instanceId) publishJob(job.manifest.instanceId, job)
    if (completed) void refresh().catch(error => setError(error.message))
  }, [jobResults.jobs, jobs, refresh, remember, publishJob])
  useEffect(() => {
    if (jobResults.error) toast.add({ title: jobResults.error.message, type: "error" })
  }, [jobResults.error])
  useEffect(() => {
    if (!asset) return
    setAssetText("")
    setHeaders([])
    let done = false
    const action = ["text", "image-list"].includes(asset.row.asset || "") ? "text" : "header"
    if (["image", "text", "image-list"].includes(asset.row.asset || "image"))
      api<{ text?: string; cards?: typeof headers }>(
        action + "?id=" + asset.row.id
      )
        .then((r) => {
          if (!done) {
            setAssetText(r.text || "")
            setHeaders(r.cards || [])
          }
        })
        .catch((e) => {
          if (!done) setError(e.message)
        })
    return () => {
      done = true
    }
  }, [asset])
  useEffect(() => {
    const row = cache[compare[0]]
    if (asset && row && asset.row.id !== row.id) setAsset({ ...asset, row })
  }, [compare, cache, asset])
  const rows = useMemo(() => Object.values(cache), [cache]),
    task = map.tasks.find((t) => t.id === map.view.selected)
  const currentJob =
    jobs.find((j) => j.id === selectedJob) ||
    jobs.find((j) => j.manifest?.instanceId === task?.id)
  const taskJob = jobs.find((j) => j.manifest?.instanceId === task?.id)
  useEffect(() => {
    setResponse(currentJob?.interaction?.initial || "")
  }, [currentJob?.interaction?.id])
  function add(name: string, ids: string[] = selectedFiles) {
    if (!catalog) return
    const s = catalog.tasks.find((s) => s.name === name)!
    let t = makeInstance(s, catalog, prefs)
    const count = map.tasks.filter((t) => t.task === name).length
    if (count) t.label = (s.taskName || name) + " " + (count + 1)
    update((m) => {
      let next = addTask(m, t)
      if (ids.length && s.inputs.length)
        next = connect(
          next,
          t.id,
          s.inputs[0].name,
          { kind: "files", ids, label: "선택한 자료" },
          false
        )
      return next
    }, `${t.label} 추가`)
    setAddOpen(false)
    if (ids === selectedFiles) setSelectedFiles([])
    setInspectorTab("input")
    setInspectorOpen(true)
    setMobilePanel("detail")
    setTaskError("")
  }
  function remove(id: string) {
    update((m) => removeTask(m, id), `${map.tasks.find(task => task.id === id)?.label || "작업"} 삭제`)
    setTaskError("")
  }
  function duplicate(id: string) {
    update(m => {
      const original = m.tasks.find(t => t.id === id)
      if (!original) return m
      if (!catalog) return m
      const layout = nodeLayout(m, catalog, rows)
      const position = layout.find(node => node.id === id)!
      const nextPosition = { x: position.x + 48, y: position.y + 48 }
      while (layout.some(node => node.x === nextPosition.x && node.y === nextPosition.y)) {
        nextPosition.x += 48
        nextPosition.y += 48
      }
      return duplicateTask(m, id, nextPosition)
    }, `${map.tasks.find(task => task.id === id)?.label || "작업"} 복제`)
    setTaskError("")
  }
  function edit(fn: (t: Instance) => Instance) {
    if (!task) return
    const id = task.id
    setTaskError("")
    update((m) => {
      const before=m.tasks.find(t=>t.id===id)!
      const after=fn(before)
      let next={...m,tasks:m.tasks.map(t=>t.id===id?after:t)}
      if(after.outputPorts!==before.outputPorts){
        for(const port of before.outputPorts || []) if(!after.outputPorts?.some(p=>p.id===port.id)) next=removeOutputPort(next,id,port.id)
        for(const port of after.outputPorts || []) if(before.outputPorts?.find(p=>p.id===port.id)!==port) next=updateOutputPort(next,id,port,catalog!)
        if(after.subflowId && after.position && catalog) next=moveTaskToSubflow(next,catalog,id,after.subflowId,after.position)
      }
      return next
    }, `${task.label} 설정 변경`)
  }

  function pick(slot: Slot, ids: string[], apply: (ids: string[]) => void) {
    setPicker({ slot, initial: ids, apply })
  }
  function chooseViewerImage(second = false) {
    pick({name: "view", label: second ? "비교" : "영상 변경", kind: "image", multiple: false}, [], ids => {
      if (!ids[0]) return
      setCompare(current => second ? [current[0], ids[0]] : [ids[0], ...current.slice(1)])
    })
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
          await api("folder", {path})
          moved = true
          await refresh()
          applyDocument(await api<Preferences>("task-preferences"))
        } catch (e) {
          if (moved) {
            try { await api("folder", {path: previousFolder}); await refresh() }
            catch { setReady(false); setLoadError(true) }
          }
          setError((e as Error).message)
        } finally { setDocumentBusy(false) }
      },
    })
  }
  function open(row: Frame, role?: string) {
    setCompare([row.id])
    setAssetView("image")
    setAsset({ row, role, taskId: task?.id })
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
  async function start(payload: unknown) {
    setLastExecution(undefined)
    setBusy(true)
    try {
      const j = await api<Job>("task-run", payload)
      setLastExecution({kind: "job", id: j.id})
      setJobs((old) => [j, ...old])
      setSelectedJob(j.id)
      setTrayOpen(true)
      publishJob(j.manifest?.instanceId || map.view.selected, j)
      setPlan(null)
    } catch (e) {
      setTaskError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function run() {
    if (!catalog || !task || runLock.current || workflowActive(workflow)) return
    runLock.current = true
    setTaskError("")
    setLastExecution(undefined)
    setPreparingName(task.label || task.task)
    setChecking(true)
    try {
      const payload = {
        ...payloadFor(map, task.id, catalog),
        workingDirectory: workspace.folder,
      }
      const p = await api<Plan>("task-validate", payload)
      if (p.filePlan.destructive) {
        setPendingPayload(payload)
        setPlan(p)
      } else {
        setChecking(false)
        await start(payload)
      }
    } catch (e) {
      setTaskError((e as Error).message)
    } finally {
      setChecking(false)
      runLock.current = false
    }
  }
  function focusError() {
    const key = taskError.match(/(?:ccdproc\.)?([A-Za-z][\w]*)[:=]/)?.[1]
    const selectedSpec = catalog?.tasks.find((spec) => spec.name === task?.task)
    const isInput = selectedSpec?.inputs.some((input) => input.name === key)
    setInspectorTab(isInput ? "input" : "settings")
    if (isInput && task && key) {
      setInputRequest((previous) => ({taskId: task.id, role: key, sequence: (previous?.sequence || 0) + 1}))
    }
    const find = () =>
      key
        ? document.querySelector(
            `[id="editor-preprocess-${key}"], [id="editor-task-${key}"], [id="source-${key}"], [id="expr-${key}"]`
          )
        : null
    const focus = () => {
      const el = find() || document.querySelector(".task-inspector [role=tabpanel] input")
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center" })
        el.focus()
      }
    }
    if (!find() && key) {
      const toggle = document.querySelector(
        `[aria-label="${key} 파일과 표현식 펼치기"]`
      )
      if (toggle instanceof HTMLButtonElement) toggle.click()
    }
    requestAnimationFrame(focus)
  }
  function headerEdit() {
    if (!asset || !catalog) return
    const t = makeInstance(
      catalog.tasks.find((s) => s.name === "ccdhedit")!,
      catalog,
      prefs
    )
    t.draft.parameters = { ...t.draft.parameters, parameter: "", value: "" }
    update((m) =>
      connect(
        addTask(m, t),
        t.id,
        "images",
        { kind: "files", ids: [asset.row.id], label: asset.row.label },
        false
      ), "ccdhedit 추가"
    )
    if (asset.taskId && asset.role)
      setOrigin({
        taskId: asset.taskId,
        role: asset.role,
        sourceId: asset.row.id,
        editorId: t.id,
      })
    setAsset(null)
    setMobilePanel("detail")
  }
  function returnEdited() {
    if (!origin || !taskJob) return
    const products = taskJob.products.filter((p) => p.asset === "image")
    const replacement = products[0]
    if (!replacement) return
    const parent = map.tasks.find((t) => t.id === origin.taskId)
    if (!parent) return
    const old = assigned(map, parent, origin.role).ids
    update((m) => {
      let next = m
      old.forEach((id, i) => {
        next = connect(
          next,
          parent.id,
          origin.role,
          id === origin.sourceId
            ? {
                kind: "result",
                taskId: origin.editorId,
                runId: taskJob.id,
                ids: [replacement.id],
              }
            : { kind: "files", ids: [id], label: cache[id]?.label || id },
          i > 0
        )
      })
      return { ...next, view: { ...next.view, selected: parent.id } }
    }, `${parent.label} 입력 교체`)
    setOrigin(null)
    setSelectedJob("")
  }
  function saveDefaults() {
    if (!task) return
    const p = prefsRef.current
    replacePreferences({
      ...p,
      drafts: {
        ...p.drafts,
        [task.task]: structuredClone(task.draft),
        ccdproc: structuredClone(
          task.task === "ccdproc" ? task.draft : task.preprocess
        ),
      },
      parameterSets: {...p.parameterSets,[task.task]:structuredClone(task.parameterSets || {})},
      mapping: { ...task.mapping },
      packageValues: { ...task.packageValues },
      instrument: [...task.instrument],
    })
    queueSave()
    setSaveState("새 작업에 적용할 설정 저장 중")
  }
  async function deleteLibrary(kind: "files" | "jobs", ids: string[]) {
    const removed = await api<{fileIds: string[]; jobIds: string[]; failedIds: string[]}>(`delete-${kind}`, {ids})
    const fileIds = new Set(removed.fileIds)
    const jobIds = new Set(removed.jobIds)
    setSelectedFiles(previous => previous.filter(id => !fileIds.has(id)))
    setCache(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => !fileIds.has(id))))
    setWorkspace(previous => ({...previous, files: previous.files.filter(file => !fileIds.has(file.id))}))
    setJobs(previous => previous.filter(job => !jobIds.has(job.id)).map(job => ({...job, products: job.products.filter(file => !fileIds.has(file.id))})))
    editor.removeLibrary(fileIds, jobIds)
    queueSave()
    if (asset && fileIds.has(asset.row.id)) setAsset(null)
    setCompare(previous => previous.filter(id => !fileIds.has(id)))
    if (jobIds.has(selectedJob)) { setSelectedJob(""); setLogRequest(null); setTrayOpen(false) }
    setWorkflow(previous => previous ? {...previous, jobs: previous.jobs.filter(job => !jobIds.has(job.id)), currentJob: previous.currentJob && jobIds.has(previous.currentJob.id) ? null : previous.currentJob} : null)
    // The deletion succeeded even if refreshing the remaining library fails.
    try { await refresh() } catch { setError("휴지통으로 이동했습니다. 남은 목록을 불러오지 못해 새로고침이 필요합니다.") }
    if (removed.failedIds.length) throw new Error("일부 항목을 휴지통으로 옮기지 못했습니다.")
  }
  function template() {
    if (!catalog) return
    let next = map
    const names = ["zerocombine", "darkcombine", "flatcombine", "ccdproc"]
    const tasks = names.map((n) =>
      makeInstance(
        catalog.tasks.find((s) => s.name === n)!,
        catalog,
        prefs
      )
    )
    for (const t of tasks) next = addTask(next, t)
    for (let i = 0; i < 3; i++)
      next = connect(
        next,
        tasks[3].id,
        ["zero", "dark", "flat"][i],
        { kind: "pending", taskId: tasks[i].id },
        false
      )
    update(() => next, "보정 워크플로우 추가")
    setAddOpen(false)
  }
  const sourceOptions = useMemo<{ key: string; label: string; description?: string; count?: number; source: Source }[]>(
    () => [
      ...(selectedFiles.length
        ? [
            {
              key: "selection",
              label: "자료 목록 선택",
              count: selectedFiles.length,
              source: {
                kind: "files",
                ids: selectedFiles,
                label: "선택한 자료",
              } as Source,
            },
          ]
        : []),
      ...map.tasks.map((t) => ({
        key: "pending:" + t.id,
        label: t.label + " 출력",
        source: { kind: "pending", taskId: t.id } as Source,
      })),
      ...jobs.flatMap((j) =>
        (j.products || [])
          .filter((p) => p.asset === "image" || p.asset === "text" || p.asset === "image-list")
          .map((p) => ({
            key: "product:" + p.id,
            label: p.label,
            description: j.id,
            source: {
              kind: "result",
              taskId: j.manifest?.instanceId,
              runId: j.id,
              ids: [p.id],
            } as Source,
          }))
      ),
    ],
    [selectedFiles, map.tasks, jobs]
  )
  const [layoutBusy, setLayoutBusy] = useState(false)
  async function autoLayout(straight = false) {
    if (layoutBusy || !catalog) return
    setLayoutBusy(true)
    try {
      const next = await autoLayoutMap(map, catalog, rows)
      update(current => {
        // Keep edits made while the engine was loading or calculating.
        if (current.tasks !== map.tasks || current.connections !== map.connections || current.subflows !== map.subflows)
          return current
        return { ...current, tasks: next.tasks, subflows: next.subflows, edgeRoutes: next.edgeRoutes,
          view: { ...current.view, ...(straight ? { edgeStyle: "smoothstep" as const } : {}) } }
      }, "자동 배치")
      setLayoutRevision((revision) => revision + 1)
    } catch {
      toast.add({ title: "자동 배치에 실패했습니다. 다시 시도해 주세요.", type: "error" })
    } finally {
      setLayoutBusy(false)
    }
  }
  return (
    <TooltipProvider>
      <div className="contents" inert={documentBusy || undefined}
        onFocusCapture={event => {
          if (event.target.matches("input:not([type=checkbox]):not([type=radio]), textarea")) editor.beginEdit()
        }}
        onBlurCapture={event => {
          if (event.target.matches("input:not([type=checkbox]):not([type=radio]), textarea")) finishEdit()
        }}
      >
      <WorkbenchShell
        libraryOpen={libraryOpen}
        onLibraryOpen={setLibraryOpen}
        trayOpen={trayOpen}
        onTrayOpen={setTrayOpen}
        inspectorOpen={inspectorOpen}
        onInspectorOpen={setInspectorOpen}
        mobilePanel={mobilePanel}
        selection={`${mobilePanel}:${task?.id || ""}`}
        header={
          <WorkbenchToolbar
            historyControls={<EditHistoryControls
              past={editHistory.past}
              future={editHistory.future}
              disabled={!ready || documentBusy || workflowStarting || workflowActive(workflow) || busy || !!running}
              onUndo={steps => restoreHistory("undo", steps)}
              onRedo={steps => restoreHistory("redo", steps)}
            />}
            diagnostics={<DiagnosticsButton
              failure={diagnosticFailure}
              resolveNode={entry => resolveDiagnosticNode(entry, map)}
              onNavigate={entry => {
                const id = resolveDiagnosticNode(entry, map)
                if (!id) return
                setMapSearch("")
                update(m => ({...m, view: {...m.view, selected: id}}))
                setInputRequest(null)
                setInspectorOpen(true)
                setMobilePanel("map")
                setRevealNode(previous => ({id, revision: (previous?.revision || 0) + 1}))
                if (entry.connectionId) setRevealConnection(previous => ({id: entry.connectionId!, revision: (previous?.revision || 0) + 1}))
              }}
            />}
            workflowSelector={<WorkflowSelector document={prefs._document}
              disabled={!ready || documentBusy || workflowStarting || workflowActive(workflow) || busy || !!running}
              onSave={saveDocument} onChange={changeDocument} onExport={exportDocument} />}
            folder={workspace.folder}
            ready={ready && !!catalog && !documentBusy && !workflowStarting && !workflowActive(workflow) && !busy && !running}
            loading={!ready && !loadError}
            onFolder={folder}
            executionStatus={executionStatus}
            workflowBusy={workflowActive(workflow)}
            runDisabled={!ready || !catalog || !map.tasks.length || workflowStarting || busy || !!running}
            onRun={() => runWorkflow()}
            onCancel={cancelWorkflow}
            settingsVisible={settingsVisible}
            trayOpen={trayOpen}
            onSettings={(open) => {
              setInspectorOpen(open)
              setMobilePanel(open ? "detail" : "map")
            }}
            onTray={setTrayOpen}
          />
        }
        navigation={
          <nav className="mobile-nav" aria-label="작업 영역">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setMobilePanel("map")}
            >
              워크플로우
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!task}
              onClick={() => {
                setInspectorOpen(true)
                setMobilePanel("detail")
              }}
            >
              {{info: "정보", input: "입력", output: "출력", dependencies: "의존성", settings: "설정"}[inspectorTab]}
            </Button>
          </nav>
        }
        library={
          <LibrarySidebar
            key={workspace.folder}
            workspace={workspace}
            catalog={catalog}
            onRefreshCatalog={async()=>{setCatalog(await api<Catalog>("catalog"))}}
            jobs={jobs}
            currentExecution={workflow}
            onViewLog={(id) => {
              setSelectedJob(id)
              setLogRequest(previous => ({id, revision: (previous?.revision || 0) + 1}))
              setTrayOpen(true)
            }}
            ready={ready}
            loadError={loadError}
            selected={selectedFiles}
            onSelect={setSelectedFiles}
            onOpen={open}
            onRefresh={refresh}
            onError={setError}
            onAddTask={(name) => add(name, [])}
            onUse={() => setAddOpen(true)}
            onDeleteFiles={ids => deleteLibrary("files", ids)}
            onDeleteJobs={ids => deleteLibrary("jobs", ids)}
          >
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() =>
                    setTheme(theme === "dark" ? "light" : "dark")
                  }
                  aria-label="테마 전환"
                >
                  {theme === "dark" ? <Sun /> : <Moon />}
                  <span>
                    {theme === "dark" ? "밝은 테마" : "어두운 테마"}
                  </span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <div className="px-2 pb-2">
              <Choice
                label="실행 엔진"
                value={task?.backend || prefs.backend}
                options={[
                  { value: "cl", label: "IRAF CL" },
                  { value: "pyraf", label: "PyRAF" },
                ]}
                onChange={(v) => {
                  if (task) edit((t) => ({ ...t, backend: v }))
                  else {
                    replacePreferences({ ...prefsRef.current, backend: v })
                    queueSave()
                  }
                }}
              />
            </div>
          </LibrarySidebar>
        }
        canvas={
          <main className="main-workspace">
            {!ready ? (
              <div className="flex min-h-0 flex-1 flex-col p-6">
                {loadError ? (
                  <Blank
                    action={
                      <Button
                        variant="outline"
                        onClick={() => { setLoadError(false); setLoadAttempt((v) => v + 1) }}
                      >
                        다시 시도
                      </Button>
                    }
                  >
                    작업을 불러오지 못했습니다
                  </Blank>
                ) : (
                  <Skeleton role="status" aria-label="워크플로우 불러오는 중" className="min-h-0 w-full flex-1" />
                )}
              </div>
            ) : (
              catalog && (
                <TaskMapView
                  search={mapSearch}
                  onSearch={setMapSearch}
                  layoutRevision={layoutRevision}
                  revealNode={revealNode}
                  revealConnection={revealConnection}
                  onAutoLayout={() => void autoLayout()}
                  onStraightEdges={() => void autoLayout(true)}
                  layoutBusy={layoutBusy}
                  onRunSubflow={runWorkflow}
                  workflowBusy={workflowActive(workflow)}
                  runDisabled={workflowStarting || busy || !!running}
                  map={map}
                  catalog={catalog}
                  rows={rows}
                  update={update}
                  onEditStart={editor.beginEdit}
                  onEditEnd={finishEdit}
                  add={() => setAddOpen(true)}
                  link={link}
                  open={open}
                  remove={remove}
                  duplicate={duplicate}
                  onInput={(id, role) => {
                    setInspectorTab("input")
                    setInputRequest((previous) => ({taskId: id, role, sequence: (previous?.sequence || 0) + 1}))
                  }}
                  onSelect={() => {
                    setInputRequest(null)
                    setInspectorOpen(true)
                    setMobilePanel("detail")
                    setTaskError("")
                  }}
                  removeLink={(id) => update((m) => disconnect(m, id), "연결 삭제")}
                />
              )
            )}
          </main>
        }
        inspector={
          <div className="inspector-pane">
            {!ready ? (
              loadError ? (
                <Blank>설정을 불러오지 못했습니다.</Blank>
              ) : (
                <div role="status" aria-label="설정 불러오는 중" className="flex h-full flex-col gap-6 overflow-hidden p-4">
                  <Skeleton className="h-6 w-1/2 shrink-0" />
                  <Skeleton className="h-9 w-full shrink-0" />
                  {[0, 1, 2, 3].map((field) => (
                    <div key={field} aria-hidden="true" className="flex flex-col gap-3">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-9 w-full" />
                      <Skeleton className="h-3 w-2/3" />
                    </div>
                  ))}
                </div>
              )
            ) : task && catalog ? (
              <>
                <TaskInspector
                  key={task.id}
                  inputRequest={inputRequest?.taskId === task.id ? inputRequest : undefined}
                  activeTab={inspectorTab}
                  onTabChange={setInspectorTab}
                  onSelectNode={(id) => {
                    setRevealNode(previous => ({ id, revision: (previous?.revision || 0) + 1 }))
                    update((m) => ({ ...m, view: { ...m.view, selected: id } }))
                    setInputRequest(null)
                    setTaskError("")
                  }}
                  catalog={catalog}
                  map={map}
                  task={task}
                  rows={rows}
                  edit={edit}
                  reorderInput={(role, ids) =>
                    update((m) =>
                      replaceRoleInputs(m, task.id, role, ids, rows), `${task.label} 입력 순서 변경`
                    )
                  }
                  pick={pick}
                  onOpen={open}
                  onRun={run}
                  busy={
                    workflowActive(workflow) ||
                    busy ||
                    !!(taskJob && active(taskJob))
                  }
                  error={taskError}
                  onErrorFocus={focusError}
                  job={taskJob}
                  saveDefaults={saveDefaults}
                  onRemove={() => remove(task.id)}
                  onDuplicate={() => duplicate(task.id)}
                  onInputSource={(role, source) => {
                    try {
                      const m = editor.getMap()
                      const value =
                        source.kind === "expression" ? source.value : ""
                      const connected = parsePort(role,"input") && source.kind !== "expression"
                        ? connectInputPort(m,catalog!,rows,task.id,role,source,source.kind!=="files")
                        : connect(
                          m,task.id,role,
                          source.kind === "expression" ? {kind:"files",ids:[],label:""} : source,
                          source.kind === "pending" && !!connectionRoles(catalog!.tasks.find(s=>s.name===task.task)!,catalog!).find(s=>s.name===role)?.multiple
                        )
                      const next = {
                        ...connected,
                        tasks: connected.tasks.map((t) =>
                          t.id === task.id
                            ? {
                                ...t,
                                expressions: {
                                  ...t.expressions,
                                  [parsePort(role,"input")?.role || role]: value,
                                },
                              }
                            : t
                        ),
                      }
                      update(() => next, `${task.label} 입력 변경`)
                      setTaskError("")
                    } catch (e) {
                      setTaskError((e as Error).message)
                    }
                  }}
                  checking={checking}
                />
                {origin?.editorId === task.id &&
                  taskJob?.products?.some((p) => p.asset === "image") && (
                    <div className="p-4">
                      <Button onClick={returnEdited}>
                        <ArrowLeft data-icon="inline-start" />이 결과로 입력
                        교체
                      </Button>
                    </div>
                  )}
              </>
            ) : (
              <Blank
                action={
                  <Button variant="outline" onClick={() => setAddOpen(true)}>
                    작업 추가
                  </Button>
                }
              >
                설정할 작업을 선택하세요
              </Blank>
            )}
          </div>
        }
        history={
          <RunHistory
            key={logRequest?.revision || 0}
            initialDetail={logRequest ? {id: logRequest.id, kind: "log"} : undefined}
            jobs={jobs}
            onSelect={setSelectedJob}
            onOpen={open}
            onCancel={(id) => {
              api("task-cancel", { id }).catch((e) => setError(e.message))
            }}
          />
        }
      />
      <Toaster />
      {picker && (
        <FilePicker
          request={picker}
          workspace={workspace}
          rows={rows}
          remember={remember}
          onClose={() => setPicker(null)}
          onDelete={ids => deleteLibrary("files", ids)}
        />
      )}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent
          className="max-h-[85dvh] overflow-auto sm:max-w-2xl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>작업 추가</DialogTitle>
          </DialogHeader>
          <Input
            aria-label="추가할 작업 검색"
            placeholder="작업 이름 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Task / 패키지</TableHead>
                <TableHead>작업</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {catalog?.tasks
                .filter((t) =>
                  [t.name, t.title, t.package]
                    .join(" ")
                    .toLowerCase()
                    .includes(query.toLowerCase())
                )
                .map((t) => (
                  <TableRow key={t.name}>
                    <TableCell>
                      {t.name}
                      <p className="text-muted-foreground">{t.package}</p>
                    </TableCell>
                    <TableCell>{t.title}</TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => add(t.name)}
                      >
                        추가
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
          <Button variant="outline" onClick={template}>
            CCD 보정 예제 추가
          </Button>
        </DialogContent>
      </Dialog>
      <Dialog
        open={workflow?.state === "confirmation"}
        onOpenChange={(v) => {
          if (!v) cancelWorkflow()
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>원본 파일 변경</DialogTitle>
          </DialogHeader>
          <p>{workflow?.plan?.description}</p>
          <ul className="max-h-60 overflow-auto">
            {workflow?.plan?.targets.map((t) => (
              <li key={t.path} className="break-all">
                {t.path}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={cancelWorkflow}>
              중단
            </Button>
            <Button
              onClick={async () => {
                try {
                  await workflowMutation.mutateAsync({
                    action: "workflow-confirm",
                    payload: { token: workflow?.plan?.token },
                  })
                } catch (e) {
                  setError((e as Error).message)
                }
              }}
            >
              변경하고 계속 실행
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!linking}
        onOpenChange={(v) => {
          if (!v) setLinking(null)
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-auto"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>입력 연결</DialogTitle>
          </DialogHeader>
          <Failure message={error} />
          {linking && catalog && (
            <>
              <FieldGroup>
                <Field>
                  <FieldLabel>대상 작업</FieldLabel>
                  <Choice
                    label="대상 작업"
                    value={linking.target}
                    options={map.tasks.map((t) => ({
                      value: t.id,
                      label: t.label,
                    }))}
                    onChange={(v) => {
                      const t = map.tasks.find((t) => t.id === v)!
                      setLinking({
                        ...linking,
                        target: v,
                        role: catalog.tasks.find((s) => s.name === t.task)!
                          .inputs[0].name,
                      })
                    }}
                  />
                </Field>
                <Field>
                  <FieldLabel>입력 항목</FieldLabel>
                  <Choice
                    label="입력 항목"
                    value={linking.role}
                    options={connectionRoles(
                      catalog.tasks.find(
                        (s) =>
                          s.name ===
                          map.tasks.find((t) => t.id === linking.target)?.task
                      ) || catalog.tasks[0],
                      catalog
                    ).map((s) => ({
                      value: s.name,
                      label: s.label,
                      description: s.name,
                    }))}
                    onChange={(v) => setLinking({ ...linking, role: v })}
                  />
                </Field>
                <Field>
                  <FieldLabel>가져올 파일 또는 결과</FieldLabel>
                  <Choice
                    label="가져올 파일 또는 결과"
                    value={linking.sourceKey}
                    options={[
                      ...(linking.source
                        ? [
                            {
                              value: "provided",
                              label:
                                linking.source.kind === "pending"
                                  ? "이 작업의 출력"
                                  : "선택한 결과",
                            },
                          ]
                        : []),
                      ...sourceOptions.map((o) => ({
                        value: o.key,
                        label: o.label,
                        description: o.description,
                        count: o.count,
                      })),
                    ]}
                    onChange={(v) => setLinking({ ...linking, sourceKey: v })}
                  />
                </Field>
              </FieldGroup>
              <Button
                variant="outline"
                onClick={() => {
                  const slot = connectionRoles(
                    catalog.tasks.find(
                      (s) =>
                        s.name ===
                        map.tasks.find((t) => t.id === linking.target)?.task
                    ) || catalog.tasks[0],
                    catalog
                  ).find((s) => s.name === linking.role)!
                  const target = linking.target,
                    role = linking.role
                  pick(slot, [], (ids) => {
                    update((m) =>
                      connect(
                        m,
                        target,
                        role,
                        { kind: "files", ids, label: slot.label },
                        false
                      ), "입력 파일 연결"
                    )
                    setLinking(null)
                  })
                }}
              >
                <FolderOpen data-icon="inline-start" />
                외부 파일에서 선택
              </Button>
              <DialogFooter>
                <Button
                  disabled={
                    !linking.target || !linking.role || !linking.sourceKey
                  }
                  onClick={() => {
                    const source =
                      linking.sourceKey === "provided"
                        ? linking.source
                        : sourceOptions.find((s) => s.key === linking.sourceKey)
                            ?.source
                    if (!source) return
                    try {
                      const next = connect(
                        map,
                        linking.target,
                        linking.role,
                        source,
                        connectionRoles(catalog!.tasks.find(s => s.name === map.tasks.find(t => t.id === linking.target)?.task)!, catalog!).find(s => s.name === linking.role)?.multiple ?? false
                      )
                      update(() => next, "연결 추가")
                      setLinking(null)
                    } catch (e) {
                      setError((e as Error).message)
                    }
                  }}
                >
                  <Link2 data-icon="inline-start" />
                  연결
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!asset}
        onOpenChange={(v) => {
          if (!v) setAsset(null)
        }}
      >
        <DialogContent className="asset-dialog" aria-describedby={undefined}>
          <div className="asset-content">
            <header className="asset-topbar">
              <DialogTitle className="asset-title" title={asset?.row.label}>
                {asset && !["plot", "text", "image-list"].includes(asset.row.asset || "image") ? <Button variant="ghost" className="viewer-filename" onClick={() => chooseViewerImage()} title="영상 변경"><span>{asset.row.label}</span></Button> : asset?.row.label}
              </DialogTitle>
              {asset &&
                !["plot", "text", "image-list"].includes(asset.row.asset || "image") && (
                  <ToggleGroup aria-label="파일 보기" variant="outline" spacing={0} value={[assetView]} onValueChange={(values) => { if (values.length) setAssetView(values[0]) }}>
                    <ToggleGroupItem value="image" aria-label="영상" title="영상"><Image /></ToggleGroupItem>
                    <ToggleGroupItem value="header" aria-label="헤더" title="헤더"><TableProperties /></ToggleGroupItem>
                  </ToggleGroup>
                )}
              {asset && (
                <ButtonGroup className="asset-actions" aria-label="파일 동작">
                  {!["plot", "text", "image-list"].includes(asset.row.asset || "image") && <ViewerToolButton label="영상 비교" onClick={() => chooseViewerImage(true)}><Columns2 /></ViewerToolButton>}
                  <ViewerToolButton
                    label="입력으로 사용"
                    onClick={() => {
                      const row = asset.row
                      setAsset(null)
                      link(undefined, {
                        kind: row.job ? "result" : "files",
                        ...(row.job
                          ? { runId: row.job }
                          : { label: row.label }),
                        ids: [row.id],
                      } as Source)
                    }}
                  >
                    <Link2 />
                  </ViewerToolButton>
                  <RevealFile id={asset.row.id} />
                </ButtonGroup>
              )}
            </header>
            {asset && (
              <>
                {asset.row.asset === "plot" ? (
                  <img
                    className="asset-plot"
                    src={"/api/plot?id=" + asset.row.id}
                    alt={asset.row.label}
                  />
                ) : ["text", "image-list"].includes(asset.row.asset || "") ? (
                  <pre className="asset-text">{assetText}</pre>
                ) : (
                  <>
                    <section aria-label="영상" hidden={assetView !== "image"} className="asset-image-panel">
                      <ViewerWorkspace
                        comparisonInHeader
                        ids={compare}
                        onStatistics={() => {
                          const row = asset.row
                          setAsset(null)
                          add("imstatistics", [row.id])
                        }}
                        rows={rows}
                        onChoose={chooseViewerImage}
                      />
                    </section>
                    <section aria-label="헤더" hidden={assetView !== "header"} className="asset-header-panel">
                      <Button
                        className="my-3"
                        variant="outline"
                        onClick={headerEdit}
                      >
                        ccdhedit으로 편집
                      </Button>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>HDU</TableHead>
                            <TableHead>키</TableHead>
                            <TableHead>값</TableHead>
                            <TableHead>설명</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {headers.map((c, i) => (
                            <TableRow key={i}>
                              <TableCell>{c.hdu}</TableCell>
                              <TableCell className="break-all">{c.key}</TableCell>
                              <TableCell className="break-all whitespace-normal">
                                {c.value}
                              </TableCell>
                              <TableCell className="whitespace-normal">
                                {c.comment}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </section>
                  </>
                )}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!plan}
        onOpenChange={(v) => {
          if (!v) setPlan(null)
        }}
      >
        <DialogContent
          className="max-h-[85dvh] overflow-auto sm:max-w-2xl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>실제 파일 변경 계획</DialogTitle>
          </DialogHeader>
          {plan && (
            <>
              <p>{plan.filePlan.description}</p>
              <p>
                백업:{" "}
                {plan.filePlan.backup ? "실행 폴더에 보관" : "사용하지 않음"}
              </p>
              <ul className="list-disc pl-5">
                {plan.filePlan.targets.map((t, i) => (
                  <li className="break-all" key={i}>
                    {t.path}
                  </li>
                ))}
              </ul>
              <pre className="overflow-auto">
                {JSON.stringify(plan.preview, null, 2)}
              </pre>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPlan(null)}>
                  수정으로 돌아가기
                </Button>
                <Button
                  disabled={busy}
                  onClick={() =>
                    start({
                      ...(pendingPayload as object),
                      fileConfirmation: plan.filePlan.token,
                    })
                  }
                >
                  표시된 파일을 대상으로 실행
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      {currentJob?.state === "waiting" &&
        currentJob.interaction?.state === "waiting" && (
          <Dialog open>
            <DialogContent
              className="max-h-[90dvh] overflow-auto sm:max-w-3xl"
              aria-describedby={undefined}
              showCloseButton={false}
            >
              <DialogHeader>
                <DialogTitle>{currentJob.name}</DialogTitle>
                <p className="text-muted-foreground">사용자 입력 대기</p>
              </DialogHeader>
              <pre className="break-all whitespace-pre-wrap">
                {currentJob.interaction.prompt}
              </pre>
              {currentJob.interaction.kind === "text" && (
                <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                  {currentJob.log?.slice(-4000)}
                </pre>
              )}
              {currentJob.interaction.kind === "cursor" && (
                <img
                  src={`/api/task-graphics?id=${currentJob.id}&request=${currentJob.interaction.id}`}
                  alt="IRAF의 현재 overscan 피팅 그래픽"
                />
              )}
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="iraf-response">
                    {currentJob.interaction.kind === "cursor"
                      ? "x y wcs key [명령]"
                      : "IRAF 응답"}
                  </FieldLabel>
                  <>
                    {currentJob.interaction.kind === "editor" ? (
                      <Textarea
                        id="iraf-response"
                        aria-label="instrument 파일 내용"
                        value={response}
                        onChange={(e) => setResponse(e.target.value)}
                        className="min-h-64"
                      />
                    ) : (
                      <Input
                        id="iraf-response"
                        value={response}
                        placeholder={
                          currentJob.interaction.kind === "cursor"
                            ? "0 0 1 : order 2"
                            : "yes"
                        }
                        onChange={(e) => setResponse(e.target.value)}
                      />
                    )}
                  </>
                </Field>
              </FieldGroup>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() =>
                    api("task-cancel", { id: currentJob.id }).catch((e) =>
                      setError(e.message)
                    )
                  }
                >
                  전체 실행 중단
                </Button>
                {currentJob.interaction.kind === "cursor" && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      api("task-respond", {
                        id: currentJob.id,
                        requestId: currentJob.interaction!.id,
                        value: "0 0 1 q",
                      })
                        .then(() => setResponse(""))
                        .catch((e) => setError(e.message))
                    }
                  >
                    현재 피팅 종료 <span className="ml-auto text-muted-foreground">q</span>
                  </Button>
                )}
                <Button
                  disabled={
                    !response && currentJob.interaction.kind !== "editor"
                  }
                  onClick={() =>
                    api("task-respond", {
                      id: currentJob.id,
                      requestId: currentJob.interaction!.id,
                      value: response,
                    })
                      .then(() => setResponse(""))
                      .catch((e) => setError(e.message))
                  }
                >
                  응답하고 이어하기
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>
    </TooltipProvider>
  )
}
export default App
