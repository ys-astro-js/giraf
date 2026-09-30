import { WorkbenchShell } from "@/components/workbench-shell"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkbenchContext } from "@/features/workbench/context"
import { useWorkbenchController } from "@/features/workbench/useWorkbenchController"
import { WorkbenchHeader } from "@/features/workbench/WorkbenchHeader"
import { WorkbenchDialogs } from "@/features/workbench/WorkbenchDialogs"

const editableField = "input:not([type=checkbox]):not([type=radio]), textarea"

function App() {
  const workbench = useWorkbenchController()
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
          <WorkbenchShell header={<WorkbenchHeader />} />
          <Toaster />
          <WorkbenchDialogs />
        </div>
      </TooltipProvider>
    </WorkbenchContext>
  )
}

export default App
