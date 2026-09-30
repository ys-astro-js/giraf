import { useRef, useState } from "react"
import { taskDisplayName } from "@/lib/workbench"
import { Pencil, Check, X, Play } from "lucide-react"
import { WindowTitle, WindowToolbar } from "@/features/dock/WindowToolbar"
import { Button } from "@/components/ui/button"
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarSpacer,
} from "@/components/toolbar"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { type Spec } from "@/lib/workbench"
import { type Instance } from "@/lib/task-map"

/**
 * The node's title, description and actions live in the window's top bar;
 * editing the title and description opens its fields above the content.
 */
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
  const title =
    task.label === task.task
      ? taskDisplayName(task.task)
      : task.label || taskDisplayName(task.task)
  const description = task.description ?? spec.description ?? spec.title
  const bars = (
    <>
      <WindowTitle
        title={title}
        subtitle={description}
        tooltip={`${spec.package}.${spec.taskName || taskDisplayName(spec.name)}\n${description}`}
      />
      <WindowToolbar>
        <ToolbarGroup label="노드 편집" overflow>
          <ToolbarButton
            ref={identityButton}
            label="제목과 설명 편집"
            aria-pressed={!!identityDraft}
            onClick={() =>
              identityDraft
                ? closeIdentity(false)
                : setIdentityDraft({ label: task.label, description })
            }
          >
            <Pencil />
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarSpacer />
        <ToolbarGroup label="작업 실행">
          <ToolbarButton
            label={checking ? "확인 중" : busy ? "실행 중" : "이 작업 실행"}
            disabled={busy || checking || spec.runnable === false}
            onClick={onRun}
          >
            <Play />
          </ToolbarButton>
        </ToolbarGroup>
      </WindowToolbar>
    </>
  )
  if (!identityDraft) return bars
  return (
    <header className="inspector-heading">
      {bars}
      <div className="inspector-title">
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
      </div>
    </header>
  )
}
