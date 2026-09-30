import { WorkbenchToolbar } from "@/components/workbench-toolbar"
import { EditHistoryControls } from "@/components/edit-history-controls"
import { DiagnosticsButton } from "@/components/diagnostics-button"
import { WorkflowSelector } from "@/components/workflow-selector"
import { resolveDiagnosticNode } from "@/lib/diagnostics"
import { useWorkbench } from "./context"
import { toggleEdge, useDock } from "@/features/dock/store"

export function WorkbenchHeader() {
  const w = useWorkbench()
  const edges = useDock((state) => state.edges)
  return (
    <WorkbenchToolbar
      historyControls={
        <EditHistoryControls
          past={w.editHistory.past}
          future={w.editHistory.future}
          disabled={w.locked}
          onUndo={(steps) => w.restoreHistory("undo", steps)}
          onRedo={(steps) => w.restoreHistory("redo", steps)}
        />
      }
      diagnostics={
        <DiagnosticsButton
          failure={w.diagnosticFailure}
          resolveNode={(entry) => resolveDiagnosticNode(entry, w.map)}
          onNavigate={w.navigateToDiagnostic}
        />
      }
      workflowSelector={
        <WorkflowSelector
          document={w.prefs._document}
          disabled={w.locked}
          onSave={w.saveDocument}
          onChange={w.changeDocument}
          onExport={w.exportDocument}
        />
      }
      folder={w.workspace.folder}
      ready={!w.locked && !!w.catalog}
      loading={!w.ready && !w.loadError}
      onFolder={w.folder}
      executionStatus={w.executionStatus}
      workflowBusy={w.workflowBusy}
      runDisabled={
        !w.ready ||
        !w.catalog ||
        !w.map.tasks.length ||
        w.workflowStarting ||
        w.busy ||
        w.running
      }
      onRun={() => w.runWorkflow()}
      onCancel={w.cancelWorkflow}
      sidebarVisible={edges.left}
      settingsVisible={edges.right}
      trayOpen={edges.bottom}
      onSidebar={() => toggleEdge("left")}
      onSettings={() => toggleEdge("right")}
      onTray={() => toggleEdge("bottom")}
    />
  )
}
