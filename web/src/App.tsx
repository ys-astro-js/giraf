import { resolveExecutionStatus, type ExecutionReference } from "@/lib/execution-status"
import { readPanelLayout } from "@/lib/panel-layout"
import { WorkbenchToolbar, type ExecutionStatus } from "@/components/workbench-toolbar"
import { autoLayoutMap } from "@/lib/subflow"
import {updateOutputPort,removeOutputPort} from "@/lib/output-ports"
import {publishWorkflowRun} from "@/lib/task-map"
import {connectInputPort} from "@/lib/workflow-flow"
import {parsePort} from "@/lib/calibration-ports"
import { LibrarySidebar } from "@/components/library-sidebar"
import { RunHistory } from "@/components/run-history"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  FolderOpen,
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
import { ViewerWorkspace } from "@/components/image-viewer"
import {
  Choice,
  Blank,
  Failure,
  Download,
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
  restoreTask,
  addTask,
  makeInstance,
  connect,
  replaceRoleInputs,
  workflowRequest,
  disconnect,
  publishRun,
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
const active = (j: Job) => ["queued", "running", "waiting"].includes(j.state)

function App() {
  const [catalog, setCatalog] = useState<Catalog | null>(null),
    [workspace, setWorkspace] = useState<Workspace>({
      folder: "",
      files: [],
      sets: [],
    }),
    [prefs, setPrefs] = useState<Preferences>(initial),
    [map, setMap] = useState<TaskMap>(emptyMap()),
    [cache, setCache] = useState<Record<string, Frame>>({}),
    [jobs, setJobs] = useState<Job[]>([])
  const [mapSearch, setMapSearch] = useState("")
  const [layoutRevision, setLayoutRevision] = useState(0)
  const [revealNode, setRevealNode] = useState<{ id: string; revision: number }>()
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState(false)
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
    [response, setResponse] = useState(""),
    [savedName, setSavedName] = useState(""),
    [saveSetOpen, setSaveSetOpen] = useState(false)
  const [trayOpen, setTrayOpen] = useState(false)
  const [logRequest, setLogRequest] = useState<{id: string; revision: number} | null>(null)
  const [inspectorOpen, setInspectorOpen] = useState(() => readPanelLayout().inspectorOpen ?? true)
  const [inspectorTab, setInspectorTab] = useState("info")
  const [inputRequest, setInputRequest] = useState<{ taskId: string; role: string; sequence: number } | null>(null)
  const isMobile = useIsMobile()
  const settingsVisible = isMobile ? mobilePanel === "detail" : inspectorOpen
  const [workflow, setWorkflow] = useState<WorkflowRun | null>(null)
  const [workflowStarting, setWorkflowStarting] = useState(false)
  const workflowLock = useRef(false)
  const [lastExecution, setLastExecution] = useState<ExecutionReference>()
  const [preparingName, setPreparingName] = useState("")
  const [workflowName, setWorkflowName] = useState("워크플로우")
  const [checking, setChecking] = useState(false)
  const runLock = useRef(false)
  const saveRevision = useRef(0)
  const changed = useRef(false),
    saving = useRef(Promise.resolve()),
    mapRef = useRef(map),
    prefsRef = useRef(prefs)
  mapRef.current = map
  prefsRef.current = prefs
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
    const w = await api<Workspace>("workspace")
    setWorkspace(w)
    remember(w.files)
  }, [remember])
  useEffect(() => {
    let done = false
    setLoadError(false)
    Promise.all([
      api<Catalog>("catalog"),
      api<Preferences & { files: Frame[] }>("task-preferences"),
      api<Workspace>("workspace"),
      api<Job[]>("jobs"),
    ])
      .then(([c, p, w, j]) => {
        if (done) return
        let recovered = p
        try {
          const pending = localStorage.getItem("giraf-pending-draft")
          if (pending) {
            recovered = JSON.parse(pending)
            changed.current = true
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
        setCatalog(c)
        setPrefs(pref)
        setMap(migrateMap(pref, c))
        setWorkspace(w)
        setJobs(j)
        remember([
          ...(p.files || []),
          ...w.files,
          ...j.flatMap((j) => j.products || []),
        ])
        setReady(true)
      })
      .catch(() => {
        if (!done) setLoadError(true)
      })
    return () => {
      done = true
    }
  }, [remember, loadAttempt])
  function update(fn: (m: TaskMap) => TaskMap) {
    changed.current = true
    setSaveState("저장 중")
    setMap(fn)
  }
  useEffect(() => {
    if (!ready || !changed.current) return
    const revision = ++saveRevision.current
    const value = { ...prefsRef.current, taskMap: mapRef.current }
    try {
      localStorage.setItem("giraf-pending-draft", JSON.stringify(value))
    } catch {
      /* Server saving remains available when storage is full. */
    }
    const timer = setTimeout(() => {
      saving.current = saving.current
        .catch(() => {})
        .then(async () => {
          if (revision !== saveRevision.current) return
          await api("task-preferences", value)
          if (revision === saveRevision.current) {
            localStorage.removeItem("giraf-pending-draft")
            setSaveState("저장됨")
          }
        })
        .catch((e) => {
          setSaveState("저장 실패")
          setError(e.message)
        })
    }, 350)
    return () => clearTimeout(timer)
  }, [map, prefs, ready])
  useEffect(() => {
    if (!ready) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    let previous = ""
    async function pollWorkflow() {
      try {
        const w = await api<WorkflowRun | null>("workflow")
        if (disposed) return
        setWorkflow(w)
        if (w && workflowActive(w)) {
          setLastExecution(current => current?.kind === "workflow" && current.id === w.id ? current : {kind: "workflow", id: w.id})
        }
        const current = w
          ? [...w.jobs, ...(w.currentJob ? [w.currentJob] : [])]
          : []
        const signature = JSON.stringify(current)
        if (current.length && signature !== previous) {
          previous = signature
          setJobs((old) =>
            [
              ...current,
              ...old.filter((j) => !current.some((n) => n.id === j.id)),
            ].filter((j, i, all) => all.findIndex((n) => n.id === j.id) === i)
          )
          remember(current.flatMap((j) => j.products || []))
          update((m) =>
            current.reduce((next, j) => {
              if (!j.manifest?.instanceId) return next
              return catalog
                ? publishWorkflowRun(next, j.manifest.instanceId, j, catalog)
                : publishRun(next, j.manifest.instanceId, j)
            }, m)
          )
        }
        if (w?.currentJob && w.state === "waiting") {
          setSelectedJob(w.currentJob.id)
          setTrayOpen(true)
        }
      } catch (e) {
        if (!disposed) setError((e as Error).message)
      } finally {
        if (!disposed) timer = setTimeout(pollWorkflow, 1200)
      }
    }
    pollWorkflow()
    return () => {
      disposed = true
      clearTimeout(timer)
    }
  }, [ready, remember, catalog])
  async function runWorkflow(subflowId?: string) {
    if (!catalog || workflowLock.current || workflowActive(workflow)) return
    workflowLock.current = true
    setLastExecution(undefined)
    setWorkflowName(subflowId ? map.subflows?.find((s) => s.id === subflowId)?.name || "워크플로우" : "워크플로우")
    setWorkflowStarting(true)
    setError("")
    try {
      const w = await api<WorkflowRun>(
        "workflow-run",
        subflowId ? subflowRequest(map, catalog, workspace.folder, subflowId) : workflowRequest(map, catalog, workspace.folder)
      )
      setLastExecution({kind: "workflow", id: w.id})
      setWorkflow(w)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      workflowLock.current = false
      setWorkflowStarting(false)
    }
  }
  async function cancelWorkflow() {
    try {
      setWorkflow(await api<WorkflowRun>("workflow-cancel", {}))
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
  const running = jobs
    .filter(active)
    .map((j) => j.id)
    .join(",")
  useEffect(() => {
    if (!running) return
    let done = false
    const poll = async () => {
      try {
        const j = await Promise.all(
          running
            .split(",")
            .map((id) => api<Job>("job?id=" + id + "&details=1"))
        )
        if (done) return
        setJobs((old) => old.map((o) => j.find((n) => n.id === o.id) || o))
        remember(j.flatMap((j) => j.products || []))
        update((m) =>
          j.reduce(
            (m, j) =>
              j.manifest?.instanceId
                ? publishRun(m, j.manifest.instanceId, j)
                : m,
            m
          )
        )
        if (j.some((j) => !active(j))) await refresh()
      } catch (e) {
        if (!done) setError((e as Error).message)
      }
    }
    poll()
    const timer = setInterval(poll, 1200)
    return () => {
      done = true
      clearInterval(timer)
    }
  }, [running, refresh, remember])
  useEffect(() => {
    if (!selectedJob) return
    let done = false
    api<Job>("job?id=" + selectedJob + "&details=1")
      .then((j) => {
        if (!done) {
          setJobs((old) => old.map((o) => (o.id === j.id ? j : o)))
          remember(j.products || [])
        }
      })
      .catch((e) => setError(e.message))
    return () => {
      done = true
    }
  }, [selectedJob, remember])
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
    })
    setAddOpen(false)
    setInspectorTab("input")
    setInspectorOpen(true)
    setMobilePanel("detail")
    setTaskError("")
  }
  function remove(id: string) {
    const before = mapRef.current
    const toastId = toast.add({
      title: "작업을 삭제했습니다.",
      timeout: 0,
      actionProps: {
        children: "되돌리기",
        onClick: () => {
          update((m) => restoreTask(m, before, id))
          toast.close(toastId)
        },
      },
    })
    update((m) => removeTask(m, id))
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
    })
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
      applyFolder: (path) =>
        api("folder", { path })
          .then(refresh)
          .catch((e) => setError(e.message)),
    })
  }
  function open(row: Frame, role?: string) {
    setCompare([row.id])
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
      update((m) =>
        publishRun(m, j.manifest?.instanceId || map.view.selected, j)
      )
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
      )
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
    })
    setOrigin(null)
    setSelectedJob("")
  }
  function saveDefaults() {
    if (!task) return
    changed.current = true
    setPrefs((p) => ({
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
    }))
    setSaveState("새 작업에 적용할 설정 저장 중")
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
    update(() => next)
    setAddOpen(false)
  }
  const sourceOptions = useMemo<{ key: string; label: string; description?: string; count?: number; source: Source }[]>(
    () => [
      ...workspace.sets.map((s, i) => ({
        key: "set:" + i,
        label: s.name,
        description: "저장한 선택",
        source: { kind: "files", ids: s.ids, label: s.name } as Source,
      })),
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
    [workspace.sets, selectedFiles, map.tasks, jobs]
  )
  const [layoutBusy, setLayoutBusy] = useState(false)
  async function autoLayout() {
    if (layoutBusy || !catalog) return
    setLayoutBusy(true)
    try {
      const next = await autoLayoutMap(map, catalog, rows)
      update(current => {
        // Keep edits made while the engine was loading or calculating.
        if (current.tasks !== map.tasks || current.connections !== map.connections || current.subflows !== map.subflows)
          return current
        return { ...current, tasks: next.tasks, subflows: next.subflows }
      })
      setLayoutRevision((revision) => revision + 1)
    } catch {
      toast.add({ title: "자동 배치에 실패했습니다. 다시 시도해 주세요.", type: "error" })
    } finally {
      setLayoutBusy(false)
    }
  }
  return (
    <TooltipProvider>
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
            folder={workspace.folder}
            ready={ready && !!catalog}
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
            onSave={() => setSaveSetOpen(true)}
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
                onChange={(v) =>
                  task
                    ? edit((t) => ({ ...t, backend: v }))
                    : setPrefs((p) => ({ ...p, backend: v }))
                }
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
                        onClick={() => setLoadAttempt((v) => v + 1)}
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
                  onAutoLayout={autoLayout}
                  layoutBusy={layoutBusy}
                  onRunSubflow={runWorkflow}
                  workflowBusy={workflowActive(workflow)}
                  runDisabled={workflowStarting || busy || !!running}
                  map={map}
                  catalog={catalog}
                  rows={rows}
                  update={update}
                  add={() => setAddOpen(true)}
                  link={link}
                  open={open}
                  remove={remove}
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
                  removeLink={(id) => update((m) => disconnect(m, id))}
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
                      replaceRoleInputs(m, task.id, role, ids, rows)
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
                  onInputSource={(role, source) => {
                    try {
                      const m = mapRef.current
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
                      update(() => next)
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
          onSaved={() => refresh().catch((e) => setError(e.message))}
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
                  setWorkflow(
                    await api<WorkflowRun>("workflow-confirm", {
                      token: workflow?.plan?.token,
                    })
                  )
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
                      )
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
                      update(() => next)
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
          <Tabs defaultValue="image" className="asset-tabs">
            <header className="asset-topbar">
              <DialogTitle className="asset-title" title={asset?.row.label}>
                {asset && !["plot", "text", "image-list"].includes(asset.row.asset || "image") ? <Button variant="ghost" className="viewer-filename" onClick={() => chooseViewerImage()} title="영상 변경"><span>{asset.row.label}</span></Button> : asset?.row.label}
              </DialogTitle>
              {asset &&
                !["plot", "text", "image-list"].includes(asset.row.asset || "image") && (
                  <TabsList>
                    <TabsTrigger value="image">영상</TabsTrigger>
                    <TabsTrigger value="header">헤더</TabsTrigger>
                  </TabsList>
                )}
              {asset && (
                <div className="asset-actions">
                  {!["plot", "text", "image-list"].includes(asset.row.asset || "image") && <Button variant="ghost" size="sm" onClick={() => chooseViewerImage(true)}>비교</Button>}
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label="입력으로 사용"
                    title="입력으로 사용"
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
                    <Link2 />입력으로 사용
                  </Button>
                  <Download id={asset.row.id} />
                </div>
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
                    <TabsContent value="image" className="asset-image-panel">
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
                    </TabsContent>
                    <TabsContent value="header" className="asset-header-panel">
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
                    </TabsContent>
                  </>
                )}
              </>
            )}
          </Tabs>
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
      <Dialog open={saveSetOpen} onOpenChange={setSaveSetOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>선택 묶음 저장</DialogTitle>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="saved-name">묶음 이름</FieldLabel>
              <Input
                id="saved-name"
                value={savedName}
                onChange={(e) => setSavedName(e.target.value)}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button
              disabled={!savedName.trim()}
              onClick={() =>
                api("save-set", { name: savedName, ids: selectedFiles })
                  .then(() => {
                    setSaveSetOpen(false)
                    return refresh()
                  })
                  .catch((e) => setError(e.message))
              }
            >
              저장
            </Button>
          </DialogFooter>
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
    </TooltipProvider>
  )
}
export default App
