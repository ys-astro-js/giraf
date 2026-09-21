import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkbenchToolbar, type ExecutionStatus } from '../src/components/workbench-toolbar'
import { SidebarProvider } from '../src/components/ui/sidebar'
import { TooltipProvider } from '../src/components/ui/tooltip'

const noop = () => {}
function renderStatus(executionStatus?: ExecutionStatus) {
  return renderToStaticMarkup(
    <TooltipProvider><SidebarProvider>
      <WorkbenchToolbar folder="/data" ready loading={false} onFolder={noop}
        workflowBusy={false} runDisabled={false} onRun={noop} onCancel={noop}
        settingsVisible trayOpen={false} onSettings={noop} onTray={noop}
        executionStatus={executionStatus} />
    </SidebarProvider></TooltipProvider>
  )
}

test('toolbar identifies the running task alongside its state and progress', () => {
  const html = renderStatus({ name: 'Master Bias', label: '실행 중', state: 'running', progress: '2/12', progressFraction: 2 / 12 })
  expect(html).toContain('Master Bias')
  expect(html).toContain('<span class="sr-only">실행 중</span>')
  expect(html).not.toContain('<span>실행 중</span>')
  expect(html).toContain('role="progressbar"')
  expect(html).toContain('aria-valuenow="17"')
  expect(html).toContain('2/12')
  expect(html).toContain('role="status"')
  expect(html).toContain('aria-atomic="true"')
  expect(html).toContain('motion-safe:animate-spin')
})

test('finished and waiting tasks keep their names and no longer show a running spinner', () => {
  for (const [state, label, icon] of [
    ['completed', '완료', 'circle-check'],
    ['failed', '실패', 'circle-alert'],
    ['cancelled', '중단됨', 'circle-stop'],
    ['waiting', '사용자 입력 대기', 'circle-pause'],
  ] as const) {
    const html = renderStatus({ name: 'ccdproc', label, state })
    expect(html).toContain('ccdproc')
    expect(html).toContain(`<span class="sr-only">${label}</span>`)
    expect(html).not.toContain(`<span>${label}</span>`)
    expect(html).toContain(`lucide-${icon}`)
    expect(html).not.toContain('animate-spin')
  }
})

test('idle toolbar does not claim that any task is running or complete', () => {
  const html = renderStatus()
  expect(html).not.toContain('실행 중')
  expect(html).not.toContain('완료')
  expect(html).toContain('toolbar-status-content')
  expect(html).toContain('data-state="idle"')
  expect(html).not.toContain('animate-spin')
  expect(html).not.toContain('role="progressbar"')
})

// Progress boundaries are specified before changing the status implementation.
test('background progress stays within bounds and unknown progress is not fabricated', () => {
  for (const [progressFraction, expected] of [[-0.2, 0], [0.5, 50], [1.4, 100]] as const) {
    const html = renderStatus({ name: 'ccdproc', label: '실행 중', state: 'running', progressFraction })
    expect(html).toContain(`aria-valuenow="${expected}"`)
    expect(html).toContain(`width:${expected}%`)
  }
  const html = renderStatus({ name: 'ccdproc', label: '실행 준비 중', state: 'running' })
  expect(html).not.toContain('role="progressbar"')
})

test('folder picker lives inside the status area and is hidden throughout execution', () => {
  const idle = renderStatus()
  expect(idle.indexOf('aria-label="폴더 열기"')).toBeGreaterThan(idle.indexOf('toolbar-status-content'))
  expect(idle).toContain('data')
  for (const state of ['running', 'waiting'] as const) {
    expect(renderStatus({name:'ccdproc',label:'실행 중',state})).not.toContain('aria-label="폴더 열기"')
  }
  for (const state of ['completed', 'failed', 'cancelled'] as const) {
    const html = renderStatus({name:'ccdproc',label:'결과',state})
    expect(html).toContain('aria-label="폴더 열기"')
    expect(html).toContain('ccdproc')
  }
})
