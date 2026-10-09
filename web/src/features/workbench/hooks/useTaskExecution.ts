import {
  workflowActive,
  type Plan,
  type WorkflowRun,
} from "@/features/workbench/types"
import { type ExecutionReference } from "@/lib/execution-status"
import { useRef, useState } from "react"
import { api, type Catalog, type Workspace, type Job, type Manifest } from "@/lib/workbench"
import { daoeditSession, type DaoeditSession } from "@/lib/daoedit"
import { payloadFor, type TaskMap } from "@/lib/task-map"
import { valueRequest, type ValueResponse, type ValueScalar } from "@/lib/values"
import { toggleTray } from "@/features/dock/store"
import type * as React from "react"

export function useTaskExecution({
  setLastExecution,
  setJobs,
  setSelectedJob,
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

  async function start(payload: unknown) {
    setLastExecution(undefined)
    setBusy(true)
    try {
      const j = await api<Job>("task-run", payload)
      setLastExecution({ kind: "job", id: j.id })
      setJobs((old) => [j, ...old])
      setSelectedJob(j.id)
      toggleTray(true)
      publishJob(j.manifest?.instanceId || map.view.selected, j)
      setPlan(null)
      return j
    } catch (e) {
      setTaskError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function run(id = map.view.selected) {
    const task = map.tasks.find((t) => t.id === id)
    if (!catalog || !task || runLock.current || workflowActive(workflow)) return
    runLock.current = true
    setTaskError("")
    setLastExecution(undefined)
    setPreparingName(task.label || task.task)
    setChecking(true)
    try {
      // Value connections are read from the latest runs before this run.
      const values = valueRequest(map, catalog)
      const links = values.links.filter((l) => l.target === task.id)
      const resolved: Record<string, ValueScalar> = {}
      if (links.length) {
        const answer = await api<ValueResponse>("values", { ...values, links, refs: [] })
        for (const link of links) {
          const outcome = answer.parameters[link.id]
          if (!outcome) continue
          if (outcome.error !== undefined) throw Error(`${link.parameter}: ${outcome.error}`)
          resolved[link.parameter] = outcome.value
        }
      }
      const payload = {
        ...payloadFor(map, task.id, catalog, resolved),
        workingDirectory: workspace.folder,
      }
      const p = await api<Plan>("task-validate", payload)
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
  }
}
