import { createEditorStore } from "@/lib/edit-history"
import {
  workflowActive,
  initialPreferences,
  type LinkDialog,
} from "@/features/workbench/types"
import { WorkflowSelector } from "@/components/workflow-selector"
import { EditHistoryControls } from "@/components/edit-history-controls"
import { DiagnosticsButton } from "@/components/diagnostics-button"
import { resolveDiagnosticNode } from "@/lib/diagnostics"
import {
  WorkbenchToolbar,
  type ExecutionStatus,
} from "@/components/workbench-toolbar"
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
  connect,
  replaceRoleInputs,
  connectionRoles,
  emptyMap,
} from "@/lib/task-map"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Blank, Choice } from "@/components/workbench-controls"
import { TaskMapView } from "@/features/workflow/WorkflowCanvas"
import { useTheme } from "@/components/theme-provider"
import { LibrarySidebar } from "@/features/library/Library"
import { Moon, Sun, ArrowLeft } from "lucide-react"
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { activeJob, apiQueryOptions } from "@/lib/queries"
import { connectInputPort } from "@/lib/workflow-flow"
import { parsePort } from "@/lib/calibration-ports"
import { TaskInspector } from "@/features/inspector/Inspector"
import { useAssetViewer } from "@/features/workbench/hooks/useAssetViewer"
import { useWorkflowDocuments } from "@/features/workbench/hooks/useWorkflowDocuments"
import { useWorkbenchBootstrap } from "@/features/workbench/hooks/useWorkbenchBootstrap"
import { useTaskEditing } from "@/features/workbench/hooks/useTaskEditing"
import { useTaskExecution } from "@/features/workbench/hooks/useTaskExecution"
import { useWorkflowExecution } from "@/features/workbench/hooks/useWorkflowExecution"
import { useJobPolling } from "@/features/workbench/hooks/useJobPolling"
import { useDocumentPersistence } from "@/features/workbench/hooks/useDocumentPersistence"
import { useWorkflowDiagnostics } from "@/features/workbench/hooks/useWorkflowDiagnostics"
import { TaskInteractionDialog } from "@/features/workbench/dialogs/TaskInteraction"
import { TaskConfirmationDialog } from "@/features/workbench/dialogs/TaskConfirmation"
import { AssetDialog } from "@/features/workbench/dialogs/Asset"
import { ConnectInputDialog } from "@/features/workbench/dialogs/ConnectInput"
import { WorkflowConfirmationDialog } from "@/features/workbench/dialogs/WorkflowConfirmation"
import { AddTaskDialog } from "@/features/workbench/dialogs/AddTask"
import { useQueryClient } from "@tanstack/react-query"
import { useJobDiagnostics } from "@/hooks/use-job-diagnostics"
import { useStore } from "zustand"
import {
  resolveExecutionStatus,
  type ExecutionReference,
} from "@/lib/execution-status"
import { readPanelLayout } from "@/lib/panel-layout"
import { RunHistory } from "@/components/run-history"
import { useIsMobile } from "@/hooks/use-mobile"
import { WorkbenchShell } from "@/components/workbench-shell"
import { toast, Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import {
  FilePicker,
  type PickerRequest,
} from "@/features/file-picker/FilePicker"

const active = activeJob

function App() {
  const { theme, setTheme } = useTheme()
  const queryClient = useQueryClient()
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
  const [revealNode, setRevealNode] = useState<{
    id: string
    revision: number
  }>()
  const [revealConnection, setRevealConnection] = useState<{
    id: string
    revision: number
  }>()
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadFailure, setLoadError] = useState(false)
  const [ready, setReady] = useState(false),
    [error, setError] = useState(""),
    [, setSaveState] = useState("저장됨"),
    [picker, setPicker] = useState<PickerRequest | null>(null),
    [addOpen, setAddOpen] = useState(false),
    [query, setQuery] = useState(""),
    [libraryOpen, setLibraryOpen] = useState(
      () =>
        readPanelLayout().libraryOpen ??
        (typeof window !== "undefined" && window.innerWidth >= 1100)
    ),
    [mobilePanel, setMobilePanel] = useState("map"),
    [selectedFiles, setSelectedFiles] = useState<string[]>([])
  const [linking, setLinking] = useState<LinkDialog | null>(null)
  const [selectedJob, setSelectedJob] = useState("")
  const [trayOpen, setTrayOpen] = useState(false)
  const [logRequest, setLogRequest] = useState<{
    id: string
    revision: number
  } | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(
    () => readPanelLayout().inspectorOpen ?? true
  )
  const [inspectorTab, setInspectorTab] = useState("info")
  const [inputRequest, setInputRequest] = useState<{
    taskId: string
    role: string
    sequence: number
  } | null>(null)
  const isMobile = useIsMobile()
  const settingsVisible = isMobile ? mobilePanel === "detail" : inspectorOpen
  useJobDiagnostics(jobs)
  const [lastExecution, setLastExecution] = useState<ExecutionReference>()
  const {
    replacePreferences,
    queueSave,
    prefsRef,
    autosave,
    finishEdit,
    saveTaskDefaults,
  } = useDocumentPersistence({ prefs, setPrefs, setSaveState, setError, editor })
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
    setTrayOpen,
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
  } = useTaskExecution({
    setLastExecution,
    setJobs,
    setSelectedJob,
    setTrayOpen,
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
  const running = jobs.some(active)
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
  const {
    asset,
    setAsset,
    setCompare,
    open,
    origin,
    returnEdited,
    chooseViewerImage,
    assetView,
    setAssetView,
    assetText,
    compare,
    headerEdit,
    headers,
  } = useAssetViewer({
    setError,
    cache,
    pick,
    task,
    catalog,
    prefs,
    update,
    setMobilePanel,
    taskJob,
    map,
    setSelectedJob,
  })
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
  function focusError() {
    const key = taskError.match(/(?:ccdproc\.)?([A-Za-z][\w]*)[:=]/)?.[1]
    const selectedSpec = catalog?.tasks.find((spec) => spec.name === task?.task)
    const isInput = selectedSpec?.inputs.some((input) => input.name === key)
    setInspectorTab(isInput ? "input" : "settings")
    if (isInput && task && key) {
      setInputRequest((previous) => ({
        taskId: task.id,
        role: key,
        sequence: (previous?.sequence || 0) + 1,
      }))
    }
    const find = () =>
      key
        ? document.querySelector(
            `[id="editor-preprocess-${key}"], [id="editor-task-${key}"], [id="source-${key}"], [id="expr-${key}"]`
          )
        : null
    const focus = () => {
      const el =
        find() ||
        document.querySelector(".task-inspector [role=tabpanel] input")
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
    setCompare((previous) => previous.filter((id) => !fileIds.has(id)))
    if (jobIds.has(selectedJob)) {
      setSelectedJob("")
      setLogRequest(null)
      setTrayOpen(false)
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
    setInspectorTab("input")
    setInspectorOpen(true)
    setMobilePanel("detail")
    setTaskError("")
  }
  function edit(fn: (task: Instance) => Instance) {
    if (!task) return
    setTaskError("")
    taskEditing.edit(fn)
  }
  function remove(id: string) {
    taskEditing.remove(id)
    setTaskError("")
  }
  function duplicate(id: string) {
    taskEditing.duplicate(id)
    setTaskError("")
  }
  function template() {
    if (taskEditing.template()) setAddOpen(false)
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
  return (
    <TooltipProvider>
      <div
        className="contents"
        inert={documentBusy || undefined}
        onFocusCapture={(event) => {
          if (
            event.target.matches(
              "input:not([type=checkbox]):not([type=radio]), textarea"
            )
          )
            editor.beginEdit()
        }}
        onBlurCapture={(event) => {
          if (
            event.target.matches(
              "input:not([type=checkbox]):not([type=radio]), textarea"
            )
          )
            finishEdit()
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
              historyControls={
                <EditHistoryControls
                  past={editHistory.past}
                  future={editHistory.future}
                  disabled={
                    !ready ||
                    documentBusy ||
                    workflowStarting ||
                    workflowActive(workflow) ||
                    busy ||
                    !!running
                  }
                  onUndo={(steps) => restoreHistory("undo", steps)}
                  onRedo={(steps) => restoreHistory("redo", steps)}
                />
              }
              diagnostics={
                <DiagnosticsButton
                  failure={diagnosticFailure}
                  resolveNode={(entry) => resolveDiagnosticNode(entry, map)}
                  onNavigate={(entry) => {
                    const id = resolveDiagnosticNode(entry, map)
                    if (!id) return
                    setMapSearch("")
                    update((m) => ({ ...m, view: { ...m.view, selected: id } }))
                    setInputRequest(null)
                    setInspectorOpen(true)
                    setMobilePanel("map")
                    setRevealNode((previous) => ({
                      id,
                      revision: (previous?.revision || 0) + 1,
                    }))
                    if (entry.connectionId)
                      setRevealConnection((previous) => ({
                        id: entry.connectionId!,
                        revision: (previous?.revision || 0) + 1,
                      }))
                  }}
                />
              }
              workflowSelector={
                <WorkflowSelector
                  document={prefs._document}
                  disabled={
                    !ready ||
                    documentBusy ||
                    workflowStarting ||
                    workflowActive(workflow) ||
                    busy ||
                    !!running
                  }
                  onSave={saveDocument}
                  onChange={changeDocument}
                  onExport={exportDocument}
                />
              }
              folder={workspace.folder}
              ready={
                ready &&
                !!catalog &&
                !documentBusy &&
                !workflowStarting &&
                !workflowActive(workflow) &&
                !busy &&
                !running
              }
              loading={!ready && !loadError}
              onFolder={folder}
              executionStatus={executionStatus}
              workflowBusy={workflowActive(workflow)}
              runDisabled={
                !ready ||
                !catalog ||
                !map.tasks.length ||
                workflowStarting ||
                busy ||
                !!running
              }
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
                {
                  {
                    info: "정보",
                    input: "입력",
                    output: "출력",
                    dependencies: "의존성",
                    settings: "설정",
                  }[inspectorTab]
                }
              </Button>
            </nav>
          }
          library={
            <LibrarySidebar
              key={workspace.folder}
              workspace={workspace}
              catalog={catalog}
              onRefreshCatalog={async () => {
                setCatalog(await api<Catalog>("catalog?refresh=1"))
              }}
              jobs={jobs}
              currentExecution={workflow}
              onViewLog={(id) => {
                setSelectedJob(id)
                setLogRequest((previous) => ({
                  id,
                  revision: (previous?.revision || 0) + 1,
                }))
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
              onDeleteFiles={(ids) => deleteLibrary("files", ids)}
              onDeleteJobs={(ids) => deleteLibrary("jobs", ids)}
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
                          onClick={() => {
                            setLoadError(false)
                            setLoadAttempt((v) => v + 1)
                          }}
                        >
                          다시 시도
                        </Button>
                      }
                    >
                      작업을 불러오지 못했습니다
                    </Blank>
                  ) : (
                    <Skeleton
                      role="status"
                      aria-label="워크플로우 불러오는 중"
                      className="min-h-0 w-full flex-1"
                    />
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
                      setInputRequest((previous) => ({
                        taskId: id,
                        role,
                        sequence: (previous?.sequence || 0) + 1,
                      }))
                    }}
                    onSelect={() => {
                      setInputRequest(null)
                      setInspectorOpen(true)
                      setMobilePanel("detail")
                      setTaskError("")
                    }}
                    removeLink={(id) =>
                      update((m) => disconnect(m, id), "연결 삭제")
                    }
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
                  <div
                    role="status"
                    aria-label="설정 불러오는 중"
                    className="flex h-full flex-col gap-6 overflow-hidden p-4"
                  >
                    <Skeleton className="h-6 w-1/2 shrink-0" />
                    <Skeleton className="h-9 w-full shrink-0" />
                    {[0, 1, 2, 3].map((field) => (
                      <div
                        key={field}
                        aria-hidden="true"
                        className="flex flex-col gap-3"
                      >
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
                    inputRequest={
                      inputRequest?.taskId === task.id
                        ? inputRequest
                        : undefined
                    }
                    activeTab={inspectorTab}
                    onTabChange={setInspectorTab}
                    onSelectNode={(id) => {
                      setRevealNode((previous) => ({
                        id,
                        revision: (previous?.revision || 0) + 1,
                      }))
                      update((m) => ({
                        ...m,
                        view: { ...m.view, selected: id },
                      }))
                      setInputRequest(null)
                      setTaskError("")
                    }}
                    catalog={catalog}
                    map={map}
                    task={task}
                    rows={rows}
                    edit={edit}
                    reorderInput={(role, ids) =>
                      update(
                        (m) => replaceRoleInputs(m, task.id, role, ids, rows),
                        `${task.label} 입력 순서 변경`
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
                    saveDefaults={() => saveTaskDefaults(task)}
                    onRemove={() => remove(task.id)}
                    onDuplicate={() => duplicate(task.id)}
                    onInputSource={(role, source) => {
                      try {
                        const m = editor.getMap()
                        const value =
                          source.kind === "expression" ? source.value : ""
                        const connected =
                          parsePort(role, "input") &&
                          source.kind !== "expression"
                            ? connectInputPort(
                                m,
                                catalog!,
                                rows,
                                task.id,
                                role,
                                source,
                                source.kind !== "files"
                              )
                            : connect(
                                m,
                                task.id,
                                role,
                                source.kind === "expression"
                                  ? { kind: "files", ids: [], label: "" }
                                  : source,
                                source.kind === "pending" &&
                                  !!connectionRoles(
                                    catalog!.tasks.find(
                                      (s) => s.name === task.task
                                    )!,
                                    catalog!
                                  ).find((s) => s.name === role)?.multiple
                              )
                        const next = {
                          ...connected,
                          tasks: connected.tasks.map((t) =>
                            t.id === task.id
                              ? {
                                  ...t,
                                  expressions: {
                                    ...t.expressions,
                                    [parsePort(role, "input")?.role || role]:
                                      value,
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
              initialDetail={
                logRequest ? { id: logRequest.id, kind: "log" } : undefined
              }
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
            onDelete={(ids) => deleteLibrary("files", ids)}
          />
        )}
        <AddTaskDialog
          addOpen={addOpen}
          setAddOpen={setAddOpen}
          query={query}
          setQuery={setQuery}
          catalog={catalog}
          add={add}
          template={template}
        />
        <WorkflowConfirmationDialog
          workflow={workflow}
          cancelWorkflow={cancelWorkflow}
          workflowMutation={workflowMutation}
          setError={setError}
        />
        <ConnectInputDialog
          linking={linking}
          setLinking={setLinking}
          error={error}
          catalog={catalog}
          map={map}
          selectedFiles={selectedFiles}
          jobs={jobs}
          pick={pick}
          update={update}
          setError={setError}
        />
        <AssetDialog
          asset={asset}
          setAsset={setAsset}
          chooseViewerImage={chooseViewerImage}
          assetView={assetView}
          setAssetView={setAssetView}
          link={link}
          assetText={assetText}
          compare={compare}
          add={add}
          rows={rows}
          headerEdit={headerEdit}
          headers={headers}
        />
        <TaskConfirmationDialog
          plan={plan}
          setPlan={setPlan}
          busy={busy}
          start={start}
          pendingPayload={pendingPayload}
        />
        {currentJob?.state === "waiting" &&
          currentJob.interaction?.state === "waiting" && (
            <TaskInteractionDialog
              currentJob={currentJob}
              key={currentJob.interaction.id}
              setError={setError}
            />
          )}
      </div>
    </TooltipProvider>
  )
}

export default App
