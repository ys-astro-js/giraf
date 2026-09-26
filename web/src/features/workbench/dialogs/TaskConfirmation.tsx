import type { Plan } from "@/features/workbench/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import type * as React from "react"

export function TaskConfirmationDialog({
  plan,
  setPlan,
  busy,
  start,
  pendingPayload,
}: {
  plan: Plan | null
  setPlan: React.Dispatch<React.SetStateAction<Plan | null>>
  busy: boolean
  start: (payload: unknown) => Promise<void>
  pendingPayload: unknown
}) {
  return (
    <Dialog
      open={!!plan}
      onOpenChange={(v) => {
        if (!v) setPlan(null)
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-auto sm:max-w-2xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>실제 파일 변경 계획</DialogTitle>
        </DialogHeader>
        {plan && (
          <>
            <p>{plan.filePlan.description}</p>
            <p>
              백업:{" "}
              {plan.filePlan.backup ? "실행 폴더에 보관" : "사용하지 않음"}
            </p>
            <ul className="list-disc pl-5">
              {plan.filePlan.targets.map((t, i) => (
                <li className="break-all" key={i}>
                  {t.path}
                </li>
              ))}
            </ul>
            <pre className="overflow-auto">
              {JSON.stringify(plan.preview, null, 2)}
            </pre>
            <DialogFooter>
              <Button variant="outline" onClick={() => setPlan(null)}>
                수정으로 돌아가기
              </Button>
              <Button
                disabled={busy}
                onClick={() =>
                  start({
                    ...(pendingPayload as object),
                    fileConfirmation: plan.filePlan.token,
                  })
                }
              >
                표시된 파일을 대상으로 실행
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
