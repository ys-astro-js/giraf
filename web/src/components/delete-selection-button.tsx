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
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="destructive"
              size="icon"
              // On the button itself: the trigger does not pass it on.
              disabled={disabled || !ids.length}
              onClick={() => setTargets([...ids])}
            />
          }
          aria-label={label}
        >
          <Trash2 />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <TrashDialog
        targets={targets}
        description={description}
        onDelete={onDelete}
        onClose={() => setTargets(null)}
      />
    </>
  )
}

/** Asks before moving `targets` to the trash; open while `targets` is set. */
export function TrashDialog({
  targets,
  description,
  onDelete,
  onClose,
}: {
  targets: string[] | null
  description: string
  onDelete: (ids: string[]) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  return (
    <Dialog
      open={!!targets?.length}
      onOpenChange={(open) => {
        if (!open && !busy) {
          setError("")
          onClose()
        }
      }}
    >
      <DialogContent showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle>
            {targets?.length}개 항목을 휴지통으로 이동할까요?
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
            onClick={() => {
              setError("")
              onClose()
            }}
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
                onClose()
              } catch {
                setError("휴지통으로 이동하지 못했습니다. 다시 시도해 주세요.")
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
  )
}
