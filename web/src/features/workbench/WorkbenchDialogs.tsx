import { FilePicker } from "@/features/file-picker/FilePicker"
import { AddTaskDialog } from "./dialogs/AddTask"
import { WorkflowConfirmationDialog } from "./dialogs/WorkflowConfirmation"
import { ConnectInputDialog } from "./dialogs/ConnectInput"
import { AssetDialog } from "./dialogs/Asset"
import { TaskConfirmationDialog } from "./dialogs/TaskConfirmation"
import { TaskInteractionDialog } from "./dialogs/TaskInteraction"
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
      <AddTaskDialog
        addOpen={w.addOpen}
        setAddOpen={w.setAddOpen}
        query={w.query}
        setQuery={w.setQuery}
        catalog={w.catalog}
        add={w.add}
        template={w.template}
      />
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
        selectedFiles={w.selectedFiles}
        jobs={w.jobs}
        pick={w.pick}
        update={w.update}
        setError={w.setError}
      />
      <AssetDialog
        asset={w.assetViewer.asset}
        setAsset={w.assetViewer.setAsset}
        chooseViewerImage={w.assetViewer.chooseViewerImage}
        assetView={w.assetViewer.assetView}
        setAssetView={w.assetViewer.setAssetView}
        link={w.link}
        assetText={w.assetViewer.assetText}
        compare={w.assetViewer.compare}
        add={w.add}
        rows={w.rows}
        headerEdit={w.assetViewer.headerEdit}
        headers={w.assetViewer.headers}
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
      {currentJob?.state === "waiting" &&
        currentJob.interaction?.state === "waiting" && (
          <TaskInteractionDialog
            currentJob={currentJob}
            key={currentJob.interaction.id}
            setError={w.setError}
          />
        )}
    </>
  )
}
