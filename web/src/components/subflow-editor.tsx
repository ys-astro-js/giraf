import { useState, useEffect, useRef, type CSSProperties } from "react"
import { Check, Terminal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  type TaskMap,
  type Subflow,
  type SubflowColor,
  uid,
} from "@/lib/task-map"
import type { Catalog } from "@/lib/workbench"
import {
  saveSubflow,
  dissolveSubflow,
  updateSubflow,
  subflowColors,
  subflowColor,
} from "@/lib/subflow"

export function SubflowEditor({
  map,
  catalog,
  group,
  container,
  taskIds = [],
  update,
  close,
  reselect,
  hidden = false,
}: {
  map: TaskMap
  catalog: Catalog
  group?: Subflow
  /** A container is edited like a group, under its own kind (각각 반복) and name. */
  container?: { kind: string; name: string }
  taskIds?: string[]
  update: (fn: (map: TaskMap) => TaskMap, label?: string) => void
  reselect?: () => void
  hidden?: boolean
  close: () => void
}) {
  const [id] = useState(() => group?.id ?? `subflow-${uid()}`)
  const [name, setName] = useState(
    container?.name ?? group?.name ?? `그룹 ${(map.subflows?.length ?? 0) + 1}`
  )
  const [color, setColor] = useState<SubflowColor>(group?.color ?? "teal")
  const [error, setError] = useState("")
  const nameInput = useRef<HTMLInputElement>(null)
  const kind = container?.kind ?? "그룹"
  const heading = group ? `${kind} 편집` : "그룹 만들기"
  useEffect(() => {
    if (hidden) return
    const frame = requestAnimationFrame(() => nameInput.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [hidden])
  return (
    <form
      className="subflow-editor"
      hidden={hidden}
      aria-label={heading}
      onKeyDown={(e) => {
        if (e.key === "Enter" && e.nativeEvent.isComposing) e.preventDefault()
        if (e.key === "Escape") {
          e.stopPropagation()
          close()
        }
      }}
      onSubmit={(e) => {
        e.preventDefault()
        try {
          const next = group
            ? updateSubflow(map, id, { name, color })
            : saveSubflow(map, catalog, { id, name, color, taskIds })
          update(() => next, group ? `${kind} 설정 변경` : "그룹 만들기")
          close()
        } catch (e) {
          setError((e as Error).message)
        }
      }}
    >
      <div className="subflow-editor-heading">
        <h2>{heading}</h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={group ? `${heading} 닫기` : "그룹 만들기 취소"}
          onClick={close}
        >
          <X />
        </Button>
      </div>
      {!group && (
        <div className="group-selection-summary">
          <span role="status" className="group-task-count" aria-label={`${taskIds.length}개 작업`}>
            <Terminal aria-hidden="true" />{taskIds.length}
          </span>
          <Button type="button" variant="ghost" size="sm" onClick={reselect}>
            다시 선택
          </Button>
        </div>
      )}
      <label htmlFor="subflow-name">이름</label>
      <Input
        id="subflow-name"
        ref={nameInput}
        value={name}
        maxLength={100}
        autoFocus
        onChange={(e) => setName(e.target.value)}
      />
      <fieldset>
        <legend>색상</legend>
        <div className="subflow-colors">
          {subflowColors.map((c) => (
            <label
              key={c.id}
              title={c.label}
              style={{ "--group-color": subflowColor(c.id) } as CSSProperties}
            >
              <input
                type="radio"
                name="subflow-color"
                value={c.id}
                checked={color === c.id}
                onChange={() => setColor(c.id)}
                aria-label={c.label}
              />
              <span>{color === c.id && <Check aria-hidden="true" />}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p className="subflow-error" role="alert">
          {error}
        </p>
      )}
      <div className="subflow-editor-actions">
        <Button
          type="button"
          variant="outline"
          hidden={!group}
          onClick={() => {
            update((m) => dissolveSubflow(m, id), `${kind} 해제`)
            close()
          }}
        >
          {kind} 해제
        </Button>
        <Button
          type="submit"
          disabled={!name.trim() || (!group && !taskIds.length)}
        >
          {group ? "저장" : "그룹 만들기"}
        </Button>
      </div>
    </form>
  )
}
