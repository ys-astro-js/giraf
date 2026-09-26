import { useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"

export function DeleteSelectionButton({
  ids,
  label,
  description,
  onDelete,
  disabled = false,
}: {
  ids: string[]
  label: string
  description: string
  onDelete: (ids: string[]) => Promise<void>
  disabled?: boolean
}) {
  const [targets, setTargets] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="destructive" size="icon" />}
          aria-label={label}
          disabled={disabled || !ids.length}
          onClick={() => {
            setError("")
            setTargets([...ids])
          }}
        >
          <Trash2 />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <Dialog
        open={targets !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setTargets(null)
        }}
      >
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>
              {targets?.length}개 항목을 휴지통으로 옮길까요?
            </DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setTargets(null)}
            >
              취소
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={async () => {
                if (!targets) return
                setBusy(true)
                setError("")
                try {
                  await onDelete(targets)
                  setTargets(null)
                } catch {
                  setError(
                    "휴지통으로 옮기지 못했습니다. 다시 시도해 주세요."
                  )
                } finally {
                  setBusy(false)
                }
              }}
            >
              {busy ? "이동 중…" : "휴지통으로 이동"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
