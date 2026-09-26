import type { Connection } from "@/lib/task-map"
import type { Draft } from "@/lib/workbench"
import { AlignmentInput } from "@/features/alignment/AlignmentInput"
import { type Frame, type Slot } from "@/lib/workbench"
import { type Instance } from "@/lib/task-map"
import type * as React from "react"

export function InspectorAlignmentSource({
  task,
  s,
  inputIds,
  referenceIds,
  onInputSource,
  reorderInput,
  allRows,
  frames,
  d,
  field,
  ids,
  links,
  expression,
  replace,
  edit,
}: {
  task: Instance
  s: Slot
  inputIds: string[]
  referenceIds: string[]
  onInputSource:
    | ((
        role: string,
        source:
          | import("@/lib/task-map").Source
          | { kind: "expression"; value: string }
      ) => void)
    | undefined
  reorderInput: (role: string, ids: string[]) => void
  allRows: Frame[]
  frames: (Frame | undefined)[]
  d: Draft
  field: React.JSX.Element
  ids: string[]
  links: Connection[]
  expression: string
  replace: (next: string[]) => void
  edit: (fn: (t: Instance) => Instance) => void
}) {
  if (s.name !== "coords" && s.name !== "shifts") return null
  return (
    <AlignmentInput
      key={JSON.stringify([task.id, s.name, inputIds])}
      name={s.name}
      backend={task.backend}
      onUseReference={(frame) => {
        if (referenceIds.length === 1 && referenceIds[0] === frame.id) return
        if (onInputSource)
          onInputSource("reference", {
            kind: "files",
            ids: [frame.id],
            label: frame.label,
          })
        else reorderInput("reference", [frame.id])
      }}
      reference={allRows.find((row) => row.id === referenceIds[0])}
      frames={
        frames.every((f) => f && f.asset !== "text") ? (frames as Frame[]) : []
      }
      coords={d.textInputs?.coords || ""}
      value={d.textInputs?.[s.name] || ""}
      fileInput={field}
      hasFile={!!(ids.length || links.length || expression)}
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
            textInputs: { ...t.draft.textInputs, [s.name]: value },
            alignmentBinding:
              t.draft.alignmentBinding ||
              (referenceIds.length &&
              !task.expressions.reference &&
              !task.expressions.input &&
              frames.every((f) => f && f.asset !== "text")
                ? { reference: referenceIds, input: inputIds }
                : undefined),
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
