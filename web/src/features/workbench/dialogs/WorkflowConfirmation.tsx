import type { WorkflowRun } from "@/features/workbench/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import type * as React from "react"

export function WorkflowConfirmationDialog({
  workflow,
  cancelWorkflow,
  workflowMutation,
  setError,
}: {
  workflow: WorkflowRun | null
  cancelWorkflow: () => Promise<void>
  workflowMutation: {
    mutateAsync: (request: {
      action: string
      payload: unknown
    }) => Promise<WorkflowRun>
  }
  setError: React.Dispatch<React.SetStateAction<string>>
}) {
  return (
    <Dialog
      open={workflow?.state === "confirmation"}
      onOpenChange={(v) => {
        if (!v) cancelWorkflow()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>원본 파일 변경</DialogTitle>
        </DialogHeader>
        <p>{workflow?.plan?.description}</p>
        <ul className="max-h-60 overflow-auto">
          {workflow?.plan?.targets.map((t) => (
            <li key={t.path} className="break-all">
              {t.path}
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={cancelWorkflow}>
            중단
          </Button>
          <Button
            onClick={async () => {
              try {
                await workflowMutation.mutateAsync({
                  action: "workflow-confirm",
                  payload: { token: workflow?.plan?.token },
                })
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          >
            변경하고 계속 실행
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
