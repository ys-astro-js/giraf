import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { WorkbenchToolbar } from "../src/components/workbench-toolbar"
import { SidebarProvider } from "../src/components/ui/sidebar"
import {
  resolveExecutionStatus,
  type ExecutionStatus,
} from "../src/lib/execution-status"

const render = (executionStatus?: ExecutionStatus) =>
  renderToStaticMarkup(
    <SidebarProvider>
      <WorkbenchToolbar
        executionStatus={executionStatus}
        folder="/observations/night-1"
        ready
        loading={false}
        workflowSelector={<button>보정 워크플로우</button>}
        onFolder={() => {}}
        workflowBusy={false}
        runDisabled={false}
        onRun={() => {}}
        onCancel={() => {}}
        settingsVisible
        trayOpen={false}
        onSettings={() => {}}
        onTray={() => {}}
      />
    </SidebarProvider>
  )

test("idle exposes folder and workflow; completed exposes its visible result", () => {
  expect(render()).toContain("night-1")
  expect(render()).toContain("보정 워크플로우")
  const completed = render({
    name: "imcopy",
    state: "completed",
    label: "완료",
    progressFraction: 1,
  })
  expect(completed).toContain('data-state="completed"')
  expect(completed).not.toContain("toolbar-status-label")
  expect(completed).toContain('class="sr-only">완료')
  expect(completed).not.toContain("night-1")
})

test("shimmer is limited to running work and the progress remains accessible", () => {
  const running = render({
    name: "imcopy",
    state: "running",
    label: "실행 중",
    progressFraction: 0.5,
  })
  expect(running).toContain("motion-safe:shimmer")
  expect(running).toContain('aria-valuenow="50"')
  for (const state of [
    "waiting",
    "completed",
    "failed",
    "cancelled",
  ] as const) {
    expect(render({ name: "imcopy", state, label: state })).not.toContain(
      "motion-safe:shimmer"
    )
  }
})

test("execution identity and workflow steps distinguish repeated names", () => {
  const workflow = {
    id: "w1",
    name: "보정",
    currentTaskName: "imcopy",
    state: "running",
    done: 0,
    total: 2,
  }
  const first = resolveExecutionStatus({ workflow, jobs: [] })!
  const second = resolveExecutionStatus({
    workflow: { ...workflow, done: 1 },
    jobs: [],
  })!
  expect(first.executionId).toBe("workflow:w1")
  expect(first.stepKey).not.toBe(second.stepKey)
  expect(first.progressCount).toBe(0)
  expect(second.progressCount).toBe(1)
  expect(second.progressTotal).toBe(2)
  const job = resolveExecutionStatus({
    jobs: [{ id: "j1", name: "imcopy", state: "running", progress: 0 }],
  })!
  expect(job.executionId).toBe("job:j1")
})
