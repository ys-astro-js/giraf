import { stateLabel } from './task-map'

export type ExecutionStatus = {
  executionId?: string
  stepKey?: string
  name: string
  label: string
  state: 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled'
  progressCount?: number
  progressTotal?: number
  progress?: string
  progressFraction?: number
}
export type ExecutionReference = {kind: 'workflow' | 'job'; id: string}
type JobStatus = {id: string; name: string; state: string; progress: number}
type WorkflowStatus = {
  id: string; name: string; currentTaskName: string; state: string; done: number; total: number
}

export function resolveExecutionStatus({ preparing, workflow, jobs, lastExecution }: {
  preparing?: ExecutionStatus
  workflow?: WorkflowStatus | null
  jobs: JobStatus[]
  lastExecution?: ExecutionReference
}): ExecutionStatus | undefined {
  if (preparing) return preparing
  const workflowActive = workflow && ['running', 'waiting', 'confirmation', 'cancelling'].includes(workflow.state)
  if (workflow && (workflowActive || (lastExecution?.kind === 'workflow' && lastExecution.id === workflow.id))) {
    let state: ExecutionStatus['state'] = 'running'
    let label = '실행 중'
    if (workflow.state === 'waiting' || workflow.state === 'confirmation') {
      state = 'waiting'
      label = workflow.state === 'waiting' ? '사용자 입력 대기' : '실행 확인 대기'
    } else if (workflow.state === 'cancelling') {
      label = '중단 중'
    } else if (!workflowActive) {
      state = workflow.state === 'completed' ? 'completed' : workflow.state === 'cancelled' ? 'cancelled' : 'failed'
      label = stateLabel(workflow.state)
    }
    return {
      executionId: `workflow:${workflow.id}`,
      stepKey: `${workflow.done}:${workflow.currentTaskName}`,
      name: workflowActive ? workflow.currentTaskName || workflow.name : workflow.name,
      label, state,
      progressCount: workflow.total > 0 ? workflow.done : undefined,
      progressTotal: workflow.total > 0 ? workflow.total : undefined,
      progress: workflow.total > 0 ? `${workflow.done}/${workflow.total}` : undefined,
      progressFraction: workflow.total > 0 ? workflow.done / workflow.total : undefined,
    }
  }
  const activeJobs = jobs.filter(job => ['queued', 'running', 'waiting'].includes(job.state))
  const job = activeJobs.find(job => job.state === 'waiting') || activeJobs[0]
    || jobs.find(job => lastExecution?.kind === 'job' && job.id === lastExecution.id)
  if (!job) return undefined
  let state: ExecutionStatus['state'] = 'running'
  if (job.state === 'waiting') state = 'waiting'
  else if (job.state === 'completed') state = 'completed'
  else if (job.state === 'cancelled') state = 'cancelled'
  else if (!['queued', 'running'].includes(job.state)) state = 'failed'
  return {
    executionId: `job:${job.id}`,
    name: job.name, label: stateLabel(job.state), state,
    progressCount: activeJobs.length > 1 ? activeJobs.length : undefined,
    progress: activeJobs.length > 1 ? `${activeJobs.length}개 작업` : undefined,
    progressFraction: job.state === 'completed' ? 1 : job.progress,
  }
}
