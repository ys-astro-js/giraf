import { assigned } from "@/lib/task-map/inputs"
import { InspectorAlignmentSource } from "./AlignmentSource"
import { InspectorFileSource } from "./FileSource"
import { parsePort, matchesGroup, groupEqual } from "@/lib/calibration-ports"
import { CursorInput } from "@/components/cursor-input"

import { type Spec, type Frame, type Slot } from "@/lib/workbench"
import { type Instance, type TaskMap } from "@/lib/task-map"

import type { Source } from "@/lib/task-map"
import type * as React from "react"
export function InspectorInputSlot({
  map,
  task,
  spec,
  rows,
  edit,
  pick,
  onOpen,
  onInputSource,
  reorderInput,
  expanded,
  setExpanded,
  s,
  compact = false,
  prefix = "",
}: {
  map: TaskMap
  task: Instance
  spec: Spec
  rows: Frame[]
  edit: (fn: (t: Instance) => Instance) => void
  pick: (slot: Slot, ids: string[], apply: (ids: string[]) => void) => void
  onOpen: (r: Frame, role?: string) => void
  onInputSource?: (
    role: string,
    source: Source | { kind: "expression"; value: string }
  ) => void
  reorderInput: (role: string, ids: string[]) => void
  expanded: Record<string, number>
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, number>>>
  s: Slot
  compact?: boolean
  prefix?: string
}) {
  const allRows = [...rows, ...map.runs.flatMap((r) => r.products)]
  const d = task.draft

  const port = parsePort(s.name, "input"),
    role = port?.role || s.name
  const assignedIds = assigned(map, task, role).ids
  const ids = port
    ? assignedIds.filter((id) => {
        const frame = allRows.find((r) => r.id === id)
        return (
          frame &&
          (frame.asset === "image-list" || matchesGroup(frame, port.group))
        )
      })
    : assignedIds
  const limit = expanded[s.name] || 0
  const expression = port ? "" : task.expressions[role] || ""
  const links = map.connections.filter(
    (c) =>
      c.target === task.id &&
      c.role === role &&
      c.source.kind !== "files" &&
      (!port || !c.targetGroup || groupEqual(c.targetGroup, port.group))
  )
  const sources = links.map(
    (c) =>
      map.tasks.find((t) => "taskId" in c.source && t.id === c.source.taskId)
        ?.label || "저장한 결과"
  )
  const summary =
    expression ||
    (sources.length
      ? [...new Set(sources)].join(", ") + " 출력"
      : ids.length === 1
        ? rows.find((r) => r.id === ids[0])?.label || "파일 1개"
        : ids.length
          ? `파일 ${ids.length}개`
          : "선택…")
  const replace = (next: string[]) => {
    onInputSource?.(s.name, { kind: "files", ids: next, label: s.label })
    if (!onInputSource) reorderInput(s.name, next)
  }
  const field = (
    <InspectorFileSource
      s={s}
      prefix={prefix}
      port={port}
      compact={compact}
      role={role}
      limit={limit}
      setExpanded={setExpanded}
      summary={summary}
      expression={expression}
      links={links}
      pick={pick}
      ids={ids}
      replace={replace}
      rows={rows}
      onOpen={onOpen}
      onInputSource={onInputSource}
      map={map}
      task={task}
    />
  )
  if (
    spec.name === "images.immatch.imalign" &&
    (s.name === "coords" || s.name === "shifts")
  ) {
    const allRows = [...rows, ...map.runs.flatMap((run) => run.products)]
    const inputIds = assigned(map, task, "input").ids
    const referenceIds = assigned(map, task, "reference").ids
    const frames = inputIds.map((id) => allRows.find((row) => row.id === id))
    return (
      <InspectorAlignmentSource
        task={task}
        s={s}
        inputIds={inputIds}
        referenceIds={referenceIds}
        onInputSource={onInputSource}
        reorderInput={reorderInput}
        allRows={allRows}
        frames={frames}
        d={d}
        field={field}
        ids={ids}
        links={links}
        expression={expression}
        replace={replace}
        edit={edit}
      />
    )
  }
  if (s.valueType !== "cursor") return field
  const imageSlot = spec.inputs.find((input) => input.kind === "image")
  const imageId = imageSlot
    ? assigned(map, task, imageSlot.name).ids[0]
    : undefined
  const frame = [...rows, ...map.runs.flatMap((run) => run.products)].find(
    (row) => row.id === imageId
  )
  return (
    <CursorInput
      key={`${task.id}:${s.name}`}
      idPrefix={prefix}
      slot={s}
      frame={frame}
      fileInput={field}
      hasFile={!!(ids.length || links.length || expression)}
      value={d.cursorCommands?.[s.name] || ""}
      onChange={(value) => {
        if (value.trim() && (ids.length || links.length || expression))
          replace([])
        edit((t) => ({
          ...t,
          expressions: {
            ...t.expressions,
            [s.name]: value.trim() ? "" : t.expressions[s.name] || "",
          },
          draft: {
            ...t.draft,
            cursorCommands: { ...t.draft.cursorCommands, [s.name]: value },
            inputs: {
              ...t.draft.inputs,
              [s.name]: value.trim() ? [] : t.draft.inputs[s.name] || [],
            },
          },
        }))
      }}
    />
  )
}
