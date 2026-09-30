import { RunHistory } from "@/components/run-history"
import { useWorkbench } from "@/features/workbench/context"
import { useLayout } from "@/features/workbench/layout-store"
import { api } from "@/lib/workbench"

export function HistoryPanel() {
  const w = useWorkbench()
  const logRequest = useLayout((state) => state.logRequest)
  return (
    <RunHistory
      key={logRequest?.revision || 0}
      initialDetail={
        logRequest ? { id: logRequest.id, kind: "log" } : undefined
      }
      jobs={w.jobs}
      onSelect={w.setSelectedJob}
      onOpen={w.assetViewer.open}
      onCancel={(id) => {
        api("task-cancel", { id }).catch((e) => w.setError(e.message))
      }}
    />
  )
}
