import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Blank } from "@/components/workbench-controls"
import { TaskMapView } from "@/features/workflow/WorkflowCanvas"
import { useWorkbench } from "@/features/workbench/context"
import { useLayout } from "@/features/workbench/layout-store"
import { revealPanel } from "@/features/dock/store"
import { WindowControls } from "@/features/dock/WindowControls"

export function WorkflowPanel() {
  const w = useWorkbench()
  const revealNode = useLayout((state) => state.revealedNode)
  const revealConnection = useLayout((state) => state.revealedConnection)
  const requestInput = useLayout((state) => state.requestInput)
  const clearInputRequest = useLayout((state) => state.clearInputRequest)
  return (
    <main className="main-workspace">
      <WindowControls className="window-controls-overlay" />
      {!w.ready ? (
        <div className="flex min-h-0 flex-1 flex-col p-6">
          {w.loadError ? (
            <Blank
              action={
                <Button variant="outline" onClick={w.retryLoad}>
                  다시 시도
                </Button>
              }
            >
              작업을 불러오지 못했습니다
            </Blank>
          ) : (
            <Skeleton
              role="status"
              aria-label="워크플로우 불러오는 중"
              className="min-h-0 w-full flex-1"
            />
          )}
        </div>
      ) : (
        w.catalog && (
          <TaskMapView
            search={w.mapSearch}
            onSearch={w.setMapSearch}
            layoutRevision={w.layoutRevision}
            revealNode={revealNode}
            revealConnection={revealConnection}
            onAutoLayout={() => void w.autoLayout()}
            onStraightEdges={() => void w.autoLayout(true)}
            layoutBusy={w.layoutBusy}
            onRunSubflow={w.runWorkflow}
            workflowBusy={w.workflowBusy}
            runDisabled={w.workflowStarting || w.busy || w.running}
            map={w.map}
            catalog={w.catalog}
            rows={w.rows}
            update={w.update}
            onEditStart={w.editor.beginEdit}
            onEditEnd={w.finishEdit}
            add={() => w.setAddOpen(true)}
            link={w.link}
            open={w.assetViewer.open}
            remove={w.remove}
            duplicate={w.duplicate}
            onInput={requestInput}
            onSelect={() => {
              clearInputRequest()
              revealPanel("inspector")
              w.setTaskError("")
            }}
            removeLink={w.removeLink}
          />
        )
      )}
    </main>
  )
}
