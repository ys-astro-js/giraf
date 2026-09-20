import type { Job } from "./workbench"

export type CurrentExecution = {
  id: string
  jobs: Job[]
  currentJob: Job | null
}
export type ExecutionGroup = { id: string; workflow: boolean; jobs: Job[] }

export function groupExecutions(
  jobs: Job[],
  current?: CurrentExecution | null
): ExecutionGroup[] {
  const currentIds = new Set(
    [
      ...(current?.jobs || []),
      ...(current?.currentJob ? [current.currentJob] : []),
    ].map((job) => job.id)
  )
  const groups = new Map<string, ExecutionGroup>()
  for (const job of [...jobs].sort((a, b) => b.id.localeCompare(a.id))) {
    const workflowId =
      job.execution?.id ||
      job.manifest?.workflowId ||
      (currentIds.has(job.id) ? current?.id : undefined)
    const id = workflowId ? `workflow:${workflowId}` : `job:${job.id}`
    const group = groups.get(id) || { id, workflow: !!workflowId, jobs: [] }
    group.jobs.unshift(job)
    groups.set(id, group)
  }
  for (const group of groups.values()) {
    group.jobs.sort((a, b) => {
      const stepA = a.execution?.step ?? a.manifest?.workflowStep
      const stepB = b.execution?.step ?? b.manifest?.workflowStep
      if (stepA !== undefined && stepB !== undefined) return stepA - stepB
      if (currentIds.has(a.id) && currentIds.has(b.id)) {
        const order = [...currentIds]
        return order.indexOf(a.id) - order.indexOf(b.id)
      }
      return a.id.localeCompare(b.id)
    })
  }
  return [...groups.values()]
}
