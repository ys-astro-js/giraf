import { assigned } from "@/lib/task-map/inputs"
import { InspectorAlignmentSource } from "./AlignmentSource"
import { InspectorFileSource } from "./FileSource"
import { CursorInput } from "@/components/cursor-input"

import { isGirafNode, type Catalog, type Spec, type Frame, type Slot } from "@/lib/workbench"
import { type Instance, type TaskMap } from "@/lib/task-map"
import { inputFiles, splitOf } from "@/lib/splits"
import { PairControl, SelectControl, SplitControl } from "./SplitControls"

import type { Source } from "@/lib/task-map"
import type { FieldIssue } from "@/lib/diagnostics"
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
  issue,
}: {
  map: TaskMap
  catalog: Catalog
  task: Instance
  spec: Spec
  rows: Frame[]
  edit: (fn: (t: Instance) => Instance) => void
  pick: (
    slot: Slot,
    ids: string[],
    apply: (ids: string[]) => void,
    title?: string
  ) => void
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
  /** The input's problem (diagnostics fieldIssues), marked on its field. */
  issue?: FieldIssue
}) {
  const d = task.draft

  const role = s.name
  const ids = assigned(map, task, role).ids
  const limit = expanded[s.name] || 0
  const expression = task.expressions[role] || ""
  const links = map.connections.filter(
    (c) => c.target === task.id && c.role === role && c.source.kind !== "files"
  )
  const sources = links.map(
    (c) =>
      map.tasks.find((t) => "taskId" in c.source && t.id === c.source.taskId)
        ?.label || "저장한 결과"
  )
  // File nodes pass their files on unchanged: name them, not their "output".
  const fromFiles =
    links.length > 0 &&
    links.every(
      (c) =>
        map.tasks.find((t) => "taskId" in c.source && t.id === c.source.taskId)
          ?.passed
    )
  // How many files the input holds shows once, at the end of the button (after 고르기).
  const summary =
    expression ||
    (sources.length
      ? [...new Set(sources)].join(", ") + (fromFiles ? "" : " 출력")
      : ids.length === 1
        ? rows.find((r) => r.id === ids[0])?.label || "파일"
        : ids.length
          ? "파일"
          : "선택…")
  const replace = (next: string[]) => {
    onInputSource?.(s.name, { kind: "files", ids: next, label: s.label })
    if (!onInputSource) reorderInput(s.name, next)
  }
  // 나누기 on a file list, or 짝 맞추기 once another input is split (lib/splits).
  const split = splitOf(task)
  const pending = assigned(map, task, role).pending.length > 0
  const several = ids.length > 1 || pending
  const control = !several || expression ? null
    : !split || split.input === role ? (s.multiple ? <SplitControl map={map} task={task} role={role} rows={rows} edit={edit} /> : null)
    : <PairControl map={map} task={task} role={role} rows={rows} edit={edit} />
  const field = (
    <InspectorFileSource
      s={s}
      // GIRAF's own nodes name their inputs in the schema; IRAF keeps its names.
      label={isGirafNode(spec) && s.label ? s.label : undefined}
      prefix={prefix}
      compact={compact}
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
      count={!expression && (links.length || ids.length) && !pending ? inputFiles(map, task, role, rows).ids.length : undefined}
      issue={issue}
    >
      {several && !expression && s.multiple && <SelectControl map={map} task={task} role={role} rows={rows} edit={edit} />}
      {control}
    </InspectorFileSource>
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
