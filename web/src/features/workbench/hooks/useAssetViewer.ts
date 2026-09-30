import type { Instance } from "@/lib/task-map"
import { type Origin } from "@/features/workbench/types"
import { assigned } from "@/lib/task-map/inputs"
import { useState } from "react"
import {
  type Catalog,
  type Preferences,
  type Frame,
  type Job,
} from "@/lib/workbench"
import { addTask, makeInstance, connect, type TaskMap } from "@/lib/task-map"
import { revealPanel } from "@/features/dock/store"
import type * as React from "react"

/** A file shown in a viewer, and the task input it was opened from. */
export type AssetTarget = { row: Frame; role?: string; taskId?: string }

/**
 * The file the following viewer shows, and the ccdhedit round trip that
 * edits an input's header and puts the edited copy back in its place.
 */
export function useAssetViewer({
  cache,
  task,
  catalog,
  prefs,
  update,
  taskJob,
  map,
  setSelectedJob,
}: {
  cache: Record<string, Frame>
  task: Instance | undefined
  catalog: Catalog | null
  prefs: Preferences
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
  taskJob: Job | undefined
  map: TaskMap
  setSelectedJob: React.Dispatch<React.SetStateAction<string>>
}) {
  const [asset, setAsset] = useState<AssetTarget | null>(null),
    [origin, setOrigin] = useState<Origin | null>(null)

  function open(row: Frame, role?: string) {
    setAsset({ row, role, taskId: task?.id })
    revealPanel("viewer")
  }

  function headerEdit(target: AssetTarget) {
    if (!catalog) return
    const t = makeInstance(
      catalog.tasks.find((s) => s.name === "ccdhedit")!,
      catalog,
      prefs
    )
    t.draft.parameters = { ...t.draft.parameters, parameter: "", value: "" }
    update(
      (m) =>
        connect(
          addTask(m, t),
          t.id,
          "images",
          { kind: "files", ids: [target.row.id], label: target.row.label },
          false
        ),
      "ccdhedit 추가"
    )
    if (target.taskId && target.role)
      setOrigin({
        taskId: target.taskId,
        role: target.role,
        sourceId: target.row.id,
        editorId: t.id,
      })
  }
  function returnEdited() {
    if (!origin || !taskJob) return
    const products = taskJob.products.filter((p) => p.asset === "image")
    const replacement = products[0]
    if (!replacement) return
    const parent = map.tasks.find((t) => t.id === origin.taskId)
    if (!parent) return
    const old = assigned(map, parent, origin.role).ids
    update((m) => {
      let next = m
      old.forEach((id, i) => {
        next = connect(
          next,
          parent.id,
          origin.role,
          id === origin.sourceId
            ? {
                kind: "result",
                taskId: origin.editorId,
                runId: taskJob.id,
                ids: [replacement.id],
              }
            : { kind: "files", ids: [id], label: cache[id]?.label || id },
          i > 0
        )
      })
      return { ...next, view: { ...next.view, selected: parent.id } }
    }, `${parent.label} 입력 교체`)
    setOrigin(null)
    setSelectedJob("")
  }

  return { asset, setAsset, open, origin, returnEdited, headerEdit }
}
