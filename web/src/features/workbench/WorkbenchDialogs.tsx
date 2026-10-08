import { FilePicker } from "@/features/file-picker/FilePicker"
import { WorkflowConfirmationDialog } from "./dialogs/WorkflowConfirmation"
import { ConnectInputDialog } from "./dialogs/ConnectInput"
import { TaskConfirmationDialog } from "./dialogs/TaskConfirmation"
import { TaskInteractionDialog } from "./dialogs/TaskInteraction"
import { CursorSessionWatcher } from "@/features/viewer/DisplayPanel"
import { waitingCursor } from "@/lib/cursor-session"
import { DaoeditViewer } from "@/features/viewer/DaoeditViewer"
import { useWorkbench } from "./context"

/** Modal flows that sit above every panel. */
export function WorkbenchDialogs() {
  const w = useWorkbench()
  const { currentJob } = w
  return (
    <>
      {w.picker && (
        <FilePicker
          request={w.picker}
          workspace={w.workspace}
          rows={w.rows}
          remember={w.remember}
          onClose={() => w.setPicker(null)}
          onDelete={(ids) => w.deleteLibrary("files", ids)}
        />
      )}
      <WorkflowConfirmationDialog
        workflow={w.workflow}
        cancelWorkflow={w.cancelWorkflow}
        workflowMutation={w.workflowMutation}
        setError={w.setError}
      />
      <ConnectInputDialog
        linking={w.linking}
        setLinking={w.setLinking}
        error={w.error}
        catalog={w.catalog}
        map={w.map}
        jobs={w.jobs}
        pick={w.pick}
        update={w.update}
        setError={w.setError}
      />
      <TaskConfirmationDialog
        plan={w.plan}
        setPlan={w.setPlan}
        busy={w.busy}
        start={async (payload) => {
          await w.start(payload)
        }}
        pendingPayload={w.pendingPayload}
      />
      {w.daoedit && (
        <DaoeditViewer
          session={w.daoedit}
          onClose={() => w.setDaoedit(null)}
          onStart={w.start}
        />
      )}
      <CursorSessionWatcher
        job={
          waitingCursor(currentJob)
            ? currentJob
            : w.jobs.find((job) => waitingCursor(job))
        }
      />
      {currentJob?.state === "waiting" &&
        currentJob.interaction?.state === "waiting" &&
        !waitingCursor(currentJob) && (
          <TaskInteractionDialog
            currentJob={currentJob}
            key={currentJob.interaction.id}
            setError={w.setError}
          />
        )}
    </>
  )
}
