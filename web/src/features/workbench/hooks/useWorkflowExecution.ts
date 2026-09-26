import type { QueryClient } from "@tanstack/react-query"
import { workflowActive, type WorkflowRun } from "@/features/workbench/types"
import { useMutation, useQuery } from "@tanstack/react-query"
import { apiQueryOptions } from "@/lib/queries"
import { type ExecutionReference } from "@/lib/execution-status"
import { useCallback, useEffect, useRef, useState } from "react"
import { toast } from "@/components/ui/toast"
import { subflowRequest } from "@/lib/subflow"
import {
  api,
  type Catalog,
  type Preferences,
  type Frame,
  type Workspace,
  type Job,
} from "@/lib/workbench"
import { workflowRequest, type TaskMap } from "@/lib/task-map"
import type * as React from "react"

const workflowOptions = apiQueryOptions<WorkflowRun | null>("workflow")
export function useWorkflowExecution({
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
}: {
  queryClient: QueryClient
  ready: boolean
  setLastExecution: React.Dispatch<
    React.SetStateAction<ExecutionReference | undefined>
  >
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>
  remember: (rows: Frame[]) => void
  publishJob: (instanceId: string, job: Job, catalog?: Catalog) => void
  catalog: Catalog | null
  setSelectedJob: React.Dispatch<React.SetStateAction<string>>
  setTrayOpen: React.Dispatch<React.SetStateAction<boolean>>
  map: TaskMap
  prefs: Preferences
  setError: React.Dispatch<React.SetStateAction<string>>
  workspace: Workspace
}) {
  const workflowMutation = useMutation({
    mutationFn: ({ action, payload }: { action: string; payload: unknown }) =>
      api<WorkflowRun>(action, payload),
    onMutate: () =>
      queryClient.cancelQueries({ queryKey: workflowOptions.queryKey }),
    onSuccess: (value) =>
      queryClient.setQueryData(workflowOptions.queryKey, value),
  })
  const workflowQuery = useQuery({
    ...workflowOptions,
    enabled: ready && !workflowMutation.isPending,
    refetchInterval: 1200,
    refetchIntervalInBackground: true,
  })
  const workflow = workflowQuery.data ?? null
  const setWorkflow = useCallback(
    (
      value:
        | WorkflowRun
        | null
        | ((previous: WorkflowRun | null) => WorkflowRun | null)
    ) => {
      queryClient.setQueryData(workflowOptions.queryKey, (previous) =>
        typeof value === "function" ? value(previous ?? null) : value
      )
    },
    [queryClient]
  )
  const [workflowStarting, setWorkflowStarting] = useState(false)
  const workflowLock = useRef(false)

  const [workflowName, setWorkflowName] = useState("워크플로우")

  const publishedWorkflowJobs = useRef(new Map<string, Job>())
  useEffect(() => {
    if (!ready || !workflow) return
    if (workflowActive(workflow)) {
      // Publish the external run into the editor's execution history.
      setLastExecution((current) =>
        current?.kind === "workflow" && current.id === workflow.id
          ? current
          : { kind: "workflow", id: workflow.id }
      )
    }
    const current = [
      ...workflow.jobs,
      ...(workflow.currentJob ? [workflow.currentJob] : []),
    ]
    if (
      current.some((job) => publishedWorkflowJobs.current.get(job.id) !== job)
    ) {
      const incoming = current.filter(
        (job) => publishedWorkflowJobs.current.get(job.id) !== job
      )
      publishedWorkflowJobs.current = new Map(
        current.map((job) => [job.id, job])
      )
      setJobs((old) =>
        [
          ...current,
          ...old.filter((job) => !current.some((next) => next.id === job.id)),
        ].filter(
          (job, index, all) =>
            all.findIndex((next) => next.id === job.id) === index
        )
      )
      remember(current.flatMap((job) => job.products || []))
      for (const job of incoming) {
        if (job.manifest?.instanceId)
          publishJob(job.manifest.instanceId, job, catalog ?? undefined)
      }
    }
    if (workflow.currentJob && workflow.state === "waiting") {
      setSelectedJob(workflow.currentJob.id)
      setTrayOpen(true)
    }
  }, [
    ready,
    workflow,
    catalog,
    remember,
    publishJob,
    setJobs,
    setLastExecution,
    setSelectedJob,
    setTrayOpen,
  ])
  useEffect(() => {
    if (workflowQuery.error)
      toast.add({ title: workflowQuery.error.message, type: "error" })
  }, [workflowQuery.error])
  async function runWorkflow(subflowId?: string) {
    if (!catalog || workflowLock.current || workflowActive(workflow)) return
    workflowLock.current = true
    setLastExecution(undefined)
    setWorkflowName(
      subflowId
        ? map.subflows?.find((s) => s.id === subflowId)?.name || "워크플로우"
        : prefs._document?.name || "워크플로우"
    )
    setWorkflowStarting(true)
    setError("")
    try {
      const w = await workflowMutation.mutateAsync({
        action: "workflow-run",
        payload: subflowId
          ? subflowRequest(map, catalog, workspace.folder, subflowId)
          : workflowRequest(map, catalog, workspace.folder),
      })
      setLastExecution({ kind: "workflow", id: w.id })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      workflowLock.current = false
      setWorkflowStarting(false)
    }
  }
  async function cancelWorkflow() {
    try {
      await workflowMutation.mutateAsync({
        action: "workflow-cancel",
        payload: {},
      })
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return {
    workflowStarting,
    workflowName,
    workflow,
    setWorkflow,
    runWorkflow,
    cancelWorkflow,
    workflowMutation,
  }
}
