import {
  workflowActive,
  type Plan,
  type WorkflowRun,
} from "@/features/workbench/types"
import { type ExecutionReference } from "@/lib/execution-status"
import { useRef, useState } from "react"
import { api, type Catalog, type Workspace, type Job } from "@/lib/workbench"
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
  }
}
