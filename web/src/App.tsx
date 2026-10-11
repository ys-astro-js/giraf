import { DockShell } from "@/features/dock/DockShell"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkbenchContext } from "@/features/workbench/context"
import { useWorkbenchController } from "@/features/workbench/useWorkbenchController"
import { useWorkbenchShortcuts } from "@/features/workbench/hooks/useWorkbenchShortcuts"
import { WorkbenchHeader } from "@/features/workbench/WorkbenchHeader"
import { WorkbenchDialogs } from "@/features/workbench/WorkbenchDialogs"
import { HomeScreen } from "@/features/home/HomeScreen"

const editableField = "input:not([type=checkbox]):not([type=radio]), textarea"

function App() {
  const workbench = useWorkbenchController()
  useWorkbenchShortcuts(workbench)
  return (
    <WorkbenchContext value={workbench}>
      <TooltipProvider>
        <div
          className="contents"
          inert={workbench.documentBusy || undefined}
          onFocusCapture={(event) => {
            if (event.target.matches(editableField))
              workbench.editor.beginEdit()
          }}
          onBlurCapture={(event) => {
            if (event.target.matches(editableField)) workbench.finishEdit()
          }}
        >
          <div className="contents" inert={workbench.home !== false || undefined}>
            <DockShell header={<WorkbenchHeader />} />
          </div>
          {workbench.home !== false && (workbench.home ? <HomeScreen /> : <div className="home-screen" />)}
          <Toaster />
          <WorkbenchDialogs />
        </div>
      </TooltipProvider>
    </WorkbenchContext>
  )
}

export default App
