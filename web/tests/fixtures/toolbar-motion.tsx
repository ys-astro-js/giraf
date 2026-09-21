// Manual motion fixture: no API requests or changes to saved workflows.
import { useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { WorkbenchToolbar } from "../../src/components/workbench-toolbar"
import { SidebarProvider } from "../../src/components/ui/sidebar"
import { DiagnosticsButton } from "../../src/components/diagnostics-button"
import { diagnostics } from "../../src/lib/diagnostics"
import { resolveExecutionStatus } from "../../src/lib/execution-status"
import "../../src/index.css"

export function Fixture() {
  const [step, setStep] = useState(-1)
  const [run, setRun] = useState(0)
  const [complete, setComplete] = useState(false)
  const serial = useRef(0)
  const status =
    step < 0
      ? undefined
      : resolveExecutionStatus({
          jobs: [],
          workflow: {
            id: String(run),
            name: "Image Reduction",
            currentTaskName: ["zerocombine", "darkcombine", "flatcombine"][
              step % 3
            ],
            state: complete ? "completed" : "running",
            done: complete ? 12 : step,
            total: 12,
          },
          lastExecution: { kind: "workflow", id: String(run) },
        })
  return (
    <SidebarProvider>
      <main className="giraf-app" style={{ width: "100%" }}>
        <WorkbenchToolbar
          executionStatus={status}
          folder="/observations/NGC2420"
          ready
          loading={false}
          workflowSelector={<button>Image Reduction</button>}
          onFolder={() => {}}
          workflowBusy={step >= 0 && !complete}
          runDisabled={false}
          onRun={() => {
            setRun(run + 1)
            setComplete(false)
            setStep(0)
          }}
          onCancel={() => setStep(-1)}
          settingsVisible
          trayOpen={false}
          onSettings={() => {}}
          onTray={() => {}}
          diagnostics={
            <DiagnosticsButton
              resolveNode={() => undefined}
              onNavigate={() => {}}
            />
          }
        />
        <div
          style={{ display: "flex", flexWrap: "wrap", gap: 20, padding: 24 }}
        >
          <button onClick={() => setStep((s) => s + 1)}>다음 단계</button>
          <button onClick={() => setComplete(true)}>완료 처리</button>
          <button
            onClick={() => {
              setRun(run + 1)
              setComplete(false)
              setStep(0)
            }}
          >
            새 실행
          </button>
          <button
            onClick={() => {
              setStep(10)
              setComplete(false)
            }}
          >
            10단계
          </button>
          <button onClick={() => setStep((s) => s + 3)}>
            같은 이름 다음 단계
          </button>
          {(["warning", "error"] as const).map((severity) => (
            <button
              key={severity}
              onClick={() =>
                diagnostics.report({
                  severity,
                  source: "Motion fixture",
                  message: `샘플 ${++serial.current}`,
                })
              }
            >
              {severity} 추가
            </button>
          ))}
          <button onClick={() => diagnostics.clear()}>표시기 비우기</button>
        </div>
      </main>
    </SidebarProvider>
  )
}
createRoot(document.getElementById("root")!).render(<Fixture />)
