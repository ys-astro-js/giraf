import { useRef, useState } from "react"
import { taskDisplayName } from "@/lib/workbench"
import { Pencil, Check, X, Play } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { type Spec } from "@/lib/workbench"
import { type Instance } from "@/lib/task-map"

export function InspectorHeading({
  task,
  edit,
  spec,
  checking,
  busy,
  onRun,
}: {
  task: Instance
  edit: (fn: (task: Instance) => Instance) => void
  spec: Spec
  checking?: boolean
  busy: boolean
  onRun: () => void
}) {
  const [identityDraft, setIdentityDraft] = useState<{
    label: string
    description: string
  } | null>(null)
  const identityButton = useRef<HTMLButtonElement>(null)
  function closeIdentity(save: boolean) {
    if (save && identityDraft)
      edit((t) => ({
        ...t,
        label: identityDraft.label.trim() || t.task,
        description: identityDraft.description,
      }))
    setIdentityDraft(null)
    requestAnimationFrame(() => identityButton.current?.focus())
  }
  return (
    <header className="inspector-heading">
      <div className="inspector-title">
        {identityDraft ? (
          <div
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return
              if (e.key === "Escape" || e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                closeIdentity(e.key === "Enter")
              }
            }}
          >
            <FieldGroup className="gap-2">
              <Field>
                <FieldLabel className="sr-only" htmlFor="node-title">
                  노드 제목
                </FieldLabel>
                <Input
                  autoFocus
                  id="node-title"
                  aria-label="노드 제목"
                  placeholder={taskDisplayName(task.task)}
                  value={identityDraft.label}
                  onChange={(e) =>
                    setIdentityDraft({
                      ...identityDraft,
                      label: e.target.value,
                    })
                  }
                />
              </Field>
              <Field>
                <FieldLabel className="sr-only" htmlFor="node-description">
                  노드 설명
                </FieldLabel>
                <Input
                  id="node-description"
                  aria-label="노드 설명"
                  value={identityDraft.description}
                  onChange={(e) =>
                    setIdentityDraft({
                      ...identityDraft,
                      description: e.target.value,
                    })
                  }
                />
              </Field>
            </FieldGroup>
            <div className="identity-actions">
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="편집 취소"
                title="편집 취소"
                onClick={() => closeIdentity(false)}
              >
                <X />
              </Button>
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="변경 적용"
                title="변경 적용"
                onClick={() => closeIdentity(true)}
              >
                <Check />
              </Button>
            </div>
          </div>
        ) : (
          <>
            <div className="identity-heading">
              <h2
                className="truncate"
                title={`${spec.package}.${spec.taskName || taskDisplayName(spec.name)}`}
              >
                {task.label === task.task
                  ? taskDisplayName(task.task)
                  : task.label || taskDisplayName(task.task)}
              </h2>
              <Button
                ref={identityButton}
                size="icon-sm"
                variant="ghost"
                aria-label="제목과 설명 편집"
                title="제목과 설명 편집"
                onClick={() =>
                  setIdentityDraft({
                    label: task.label,
                    description:
                      task.description ?? spec.description ?? spec.title,
                  })
                }
              >
                <Pencil />
              </Button>
            </div>
            <span
              className="text-muted-foreground"
              title={task.description ?? spec.description ?? spec.title}
            >
              {task.description ?? spec.description ?? spec.title}
            </span>
          </>
        )}
      </div>
      <Button
        size="icon"
        variant="secondary"
        aria-label={checking ? "확인 중" : busy ? "실행 중" : "실행"}
        title={checking ? "확인 중" : busy ? "실행 중" : "실행"}
        disabled={busy || checking || spec.runnable === false}
        onClick={onRun}
      >
        <Play />
      </Button>
    </header>
  )
}
