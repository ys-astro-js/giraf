import type { CalibrationGroup } from "@/lib/calibration-ports"
import type { Connection } from "@/lib/task-map"
import { groupLabel } from "@/lib/calibration-ports"
import { CalibrationPortLabel } from "@/components/calibration-controls"
import { ParameterHelp } from "@/components/workbench-controls"
import { FolderOpen, X, ArrowUp, ArrowDown, ChevronDown } from "lucide-react"
import { CountBadge } from "@/components/count-badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Choice } from "@/components/workbench-controls"
import { type Frame, type Slot } from "@/lib/workbench"
import { type Instance, type TaskMap } from "@/lib/task-map"
import type * as React from "react"

export function InspectorFileSource({
  s,
  prefix,
  port,
  compact,
  role,
  limit,
  setExpanded,
  summary,
  expression,
  links,
  pick,
  ids,
  replace,
  rows,
  onOpen,
  onInputSource,
  map,
  task,
}: {
  s: Slot
  prefix: string
  port: { role: string; group: CalibrationGroup } | undefined
  compact: boolean
  role: string
  limit: number
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, number>>>
  summary: string
  expression: string
  links: Connection[]
  pick: (slot: Slot, ids: string[], apply: (ids: string[]) => void) => void
  ids: string[]
  replace: (next: string[]) => void
  rows: Frame[]
  onOpen: (r: Frame, role?: string) => void
  onInputSource:
    | ((
        role: string,
        source:
          | import("@/lib/task-map").Source
          | { kind: "expression"; value: string }
      ) => void)
    | undefined
  map: TaskMap
  task: Instance
}) {
  return (
    <Field key={s.name} className="input-slot">
      {s.valueType !== "cursor" && (
        <FieldLabel htmlFor={`${prefix}source-${s.name}`}>
          {port ? (
            <CalibrationPortLabel
              role={compact ? undefined : role}
              group={port.group}
            />
          ) : (
            s.name
          )}
          {s.required && <span aria-hidden="true">*</span>}
        </FieldLabel>
      )}
      <Button
        id={`${prefix}source-${s.name}`}
        variant="outline"
        className="w-full min-w-0 justify-between"
        aria-label={`${port ? role + " " + groupLabel(port.group) : s.name} 입력 변경`}
        aria-describedby={
          !port && !compact && s.valueType !== "cursor"
            ? `${prefix}source-${s.name}-description`
            : undefined
        }
        aria-expanded={limit > 0}
        onClick={() => setExpanded((v) => ({ ...v, [s.name]: limit ? 0 : 5 }))}
      >
        <span className="truncate">{summary}</span>
        <ChevronDown />
      </Button>
      {!port && !compact && s.valueType !== "cursor" && (
        <ParameterHelp
          p={{ name: s.name, prompt: s.label, min: "", max: "" }}
          id={`${prefix}source-${s.name}-description`}
        />
      )}
      {limit > 0 && (
        <Tabs
          defaultValue={
            expression ? "expression" : links.length ? "node" : "files"
          }
        >
          <TabsList className="w-full">
            <TabsTrigger value="files">파일</TabsTrigger>
            {!port && <TabsTrigger value="expression">표현식</TabsTrigger>}
            <TabsTrigger value="node">노드 출력</TabsTrigger>
          </TabsList>
          <TabsContent value="files">
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                pick(s, ids, (next) => {
                  replace(next)
                  setExpanded((v) => ({ ...v, [s.name]: 0 }))
                })
              }
            >
              <FolderOpen />
              찾아보기…
            </Button>
            <ul className="input-files">
              {ids.slice(0, limit).map((id, i) => {
                const r = rows.find((r) => r.id === id)
                return (
                  <li key={id + ":" + i}>
                    <Button
                      variant="link"
                      size="sm"
                      className="min-w-0 flex-1 justify-start px-0"
                      onClick={() => r && onOpen(r, s.name)}
                    >
                      <span className="truncate">{r?.label || id}</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${i + 1}번 입력 위로 이동`}
                      disabled={i === 0}
                      onClick={() => {
                        const next = [...ids]
                        ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                        replace(next)
                      }}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${i + 1}번 입력 아래로 이동`}
                      disabled={i === ids.length - 1}
                      onClick={() => {
                        const next = [...ids]
                        ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
                        replace(next)
                      }}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`${r?.label || id} 입력 해제`}
                      onClick={() => replace(ids.filter((_, n) => n !== i))}
                    >
                      <X />
                    </Button>
                  </li>
                )
              })}
              {ids.length > limit && (
                <li>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setExpanded((v) => ({ ...v, [s.name]: limit + 50 }))
                    }
                  >
                    더 보기 <CountBadge count={ids.length - limit} />
                  </Button>
                </li>
              )}
            </ul>
          </TabsContent>
          <TabsContent value="expression">
            <Input
              id={`${prefix}expr-${s.name}`}
              aria-label={`${s.name} 표현식`}
              placeholder="파일명 또는 표현식"
              value={expression}
              onChange={(e) =>
                onInputSource?.(s.name, {
                  kind: "expression",
                  value: e.target.value,
                })
              }
            />
          </TabsContent>
          <TabsContent value="node">
            <Choice
              label={`${s.name} 연결할 작업`}
              value={
                links.length && "taskId" in links[0].source
                  ? links[0].source.taskId || ""
                  : ""
              }
              options={map.tasks
                .filter((t) => t.id !== task.id)
                .map((t) => ({ value: t.id, label: t.label }))}
              onChange={(id) => {
                onInputSource?.(s.name, { kind: "pending", taskId: id })
                setExpanded((v) => ({ ...v, [s.name]: 0 }))
              }}
            />
          </TabsContent>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              replace([])
              setExpanded((v) => ({ ...v, [s.name]: 0 }))
            }}
          >
            입력 비우기
          </Button>
        </Tabs>
      )}
    </Field>
  )
}
