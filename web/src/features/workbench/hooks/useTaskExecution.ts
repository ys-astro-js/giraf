import {
  workflowActive,
  type Plan,
  type WorkflowRun,
} from "@/features/workbench/types"
import { type ExecutionReference } from "@/lib/execution-status"
import { useRef, useState } from "react"
import { api, type Catalog, type Workspace, type Job, type Manifest } from "@/lib/workbench"
import { daoeditSession, type DaoeditSession } from "@/lib/daoedit"
import { parseTvmark, tvmarkPreview, tvmarkSource, tvmarkStyle, type TvmarkSession } from "@/lib/tvmark"
import { payloadFor, type TaskMap } from "@/lib/task-map"
import type * as React from "react"

export function useTaskExecution({
  setLastExecution,
  setJobs,
  setSelectedJob,
  setTrayOpen,
  publishJob,
  map,
  catalog,
  workflow,
  workspace,
}: {
  setLastExecution: React.Dispatch<
    React.SetStateAction<ExecutionReference | undefined>
  >
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>
  setSelectedJob: React.Dispatch<React.SetStateAction<string>>
  setTrayOpen: React.Dispatch<React.SetStateAction<boolean>>
  publishJob: (instanceId: string, job: Job, catalog?: Catalog) => void
  map: TaskMap
  catalog: Catalog | null
  workflow: WorkflowRun | null
  workspace: Workspace
}) {
  const [busy, setBusy] = useState(false),
    [taskError, setTaskError] = useState(""),
    [plan, setPlan] = useState<Plan | null>(null),
    [pendingPayload, setPendingPayload] = useState<unknown>(null)

  const [preparingName, setPreparingName] = useState("")
  const [checking, setChecking] = useState(false)
  const runLock = useRef(false)
  const [daoedit, setDaoedit] = useState<DaoeditSession | null>(null)
  const [tvmark, setTvmark] = useState<TvmarkSession | null>(null)

  async function openTvmark(manifest: Manifest) {
    const coords = tvmarkPreview(manifest)
    if (!coords) return false
    // Download the complete list: the text preview endpoint truncates long files.
    async function read(id: string) {
      const response = await fetch(`/api/download?id=${encodeURIComponent(id)}`)
      if (!response.ok) throw new Error("좌표 또는 표시 설정 파일을 읽지 못했습니다.")
      return response.text()
    }
    const [text, radii, lengths, job] = await Promise.all([
      read(coords.id),
      manifest.inputs.radii?.[0] ? read(manifest.inputs.radii[0]) : String(manifest.parameters.radii ?? "0"),
      manifest.inputs.lengths?.[0] ? read(manifest.inputs.lengths[0]) : String(manifest.parameters.lengths ?? "0"),
      coords.job ? api<Job>(`job?id=${encodeURIComponent(coords.job)}&details=1`) : undefined,
    ])
    const appearance = tvmarkStyle(manifest.parameters, radii, lengths)
    const markers = parseTvmark(text, manifest.parameters).map(marker => ({ ...marker, appearance }))
    setTvmark({ coords, markers, frame: job ? tvmarkSource(coords.id, job) : undefined })
    return true
  }

  async function start(payload: unknown) {
    setLastExecution(undefined)
    setBusy(true)
    try {
      const j = await api<Job>("task-run", payload)
      setLastExecution({ kind: "job", id: j.id })
      setJobs((old) => [j, ...old])
      setSelectedJob(j.id)
      setTrayOpen(true)
      publishJob(j.manifest?.instanceId || map.view.selected, j)
      setPlan(null)
      return j
    } catch (e) {
      setTaskError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function run() {
    const task = map.tasks.find((t) => t.id === map.view.selected)
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
      if (await openTvmark(p.effective as Manifest)) return
      const viewer = daoeditSession(payload, p.effective as Manifest)
      if (viewer) {
        setDaoedit(viewer)
        return
      }
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

  return {
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
    tvmark,
    setTvmark,
  }
}
