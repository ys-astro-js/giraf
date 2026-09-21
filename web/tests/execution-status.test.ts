import { expect, test } from 'bun:test'
import { resolveExecutionStatus } from '../src/lib/execution-status'

test('a run remains visible on the same snapshot that reports completion', () => {
  for (const state of ['queued', 'running', 'waiting', 'completed', 'failed', 'cancelled']) {
    const status = resolveExecutionStatus({
      jobs: [{id:'job-1',name:'ccdproc',state,progress:0.5}],
      lastExecution: {kind:'job',id:'job-1'},
    })
    expect(status).toBeDefined()
    expect(status?.name).toBe('ccdproc')
  }
})

test('workflow completion needs no follow-up effect and an older workflow cannot replace a new task', () => {
  const workflow = {id:'workflow-1',name:'워크플로우',currentTaskName:'zerocombine',state:'completed',done:3,total:3}
  expect(resolveExecutionStatus({workflow,jobs:[],lastExecution:{kind:'workflow',id:workflow.id}})).toMatchObject({state:'completed',progress:'3/3',progressFraction:1})
  expect(resolveExecutionStatus({workflow,jobs:[{id:'job-2',name:'ccdproc',state:'completed',progress:1}],lastExecution:{kind:'job',id:'job-2'}})).toMatchObject({name:'ccdproc',state:'completed'})
  expect(resolveExecutionStatus({workflow,jobs:[]})).toBeUndefined()
})
