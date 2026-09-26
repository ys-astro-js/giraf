import type { Instance } from "@/lib/task-map"
import { type Origin } from "@/features/workbench/types"
import { assigned } from "@/lib/task-map/inputs"
import { useEffect, useState } from "react"
import {
  api,
  type Catalog,
  type Preferences,
  type Frame,
  type Job,
  type Slot,
} from "@/lib/workbench"
import { addTask, makeInstance, connect, type TaskMap } from "@/lib/task-map"
import type * as React from "react"

export function useAssetViewer({
  setError,
  cache,
  pick,
  task,
  catalog,
  prefs,
  update,
  setMobilePanel,
  taskJob,
  map,
  setSelectedJob,
}: {
  setError: React.Dispatch<React.SetStateAction<string>>
  cache: Record<string, Frame>
  pick: (slot: Slot, ids: string[], apply: (ids: string[]) => void) => void
  task: Instance | undefined
  catalog: Catalog | null
  prefs: Preferences
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
  setMobilePanel: React.Dispatch<React.SetStateAction<string>>
  taskJob: Job | undefined
  map: TaskMap
  setSelectedJob: React.Dispatch<React.SetStateAction<string>>
}) {
  const [asset, setAsset] = useState<{
      row: Frame
      role?: string
      taskId?: string
    } | null>(null),
    [assetView, setAssetView] = useState("image"),
    [assetText, setAssetText] = useState(""),
    [headers, setHeaders] = useState<
      { key: string; value: string; comment: string; hdu: number }[]
    >([]),
    [compare, setCompare] = useState<string[]>([]),
    [origin, setOrigin] = useState<Origin | null>(null)

  useEffect(() => {
    if (!asset) return
    setAssetText("")
    setHeaders([])
    let done = false
    const action = ["text", "image-list"].includes(asset.row.asset || "")
      ? "text"
      : "header"
    if (["image", "text", "image-list"].includes(asset.row.asset || "image"))
      api<{ text?: string; cards?: typeof headers }>(
        action + "?id=" + asset.row.id
      )
        .then((r) => {
          if (!done) {
            setAssetText(r.text || "")
            setHeaders(r.cards || [])
          }
        })
        .catch((e) => {
          if (!done) setError(e.message)
        })
    return () => {
      done = true
    }
  }, [asset, setError])
  useEffect(() => {
    const row = cache[compare[0]]
    if (asset && row && asset.row.id !== row.id) setAsset({ ...asset, row })
  }, [compare, cache, asset])

  function chooseViewerImage(second = false) {
    pick(
      {
        name: "view",
        label: second ? "비교" : "영상 변경",
        kind: "image",
        multiple: false,
      },
      [],
      (ids) => {
        if (!ids[0]) return
        setCompare((current) =>
          second ? [current[0], ids[0]] : [ids[0], ...current.slice(1)]
        )
      }
    )
  }

  function open(row: Frame, role?: string) {
    setCompare([row.id])
    setAssetView("image")
    setAsset({ row, role, taskId: task?.id })
  }

  function headerEdit() {
    if (!asset || !catalog) return
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
          { kind: "files", ids: [asset.row.id], label: asset.row.label },
          false
        ),
      "ccdhedit 추가"
    )
    if (asset.taskId && asset.role)
      setOrigin({
        taskId: asset.taskId,
        role: asset.role,
        sourceId: asset.row.id,
        editorId: t.id,
      })
    setAsset(null)
    setMobilePanel("detail")
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

  return {
    asset,
    setAsset,
    setCompare,
    open,
    origin,
    returnEdited,
    chooseViewerImage,
    assetView,
    setAssetView,
    assetText,
    compare,
    headerEdit,
    headers,
  }
}
