import type { TaskMap } from "@/lib/task-map"
import type { Catalog } from "@/lib/workbench"
import { useState } from "react"
import { type Edge, type ReactFlowInstance } from "@xyflow/react"
import { moveTaskToSubflow, subflowDropTarget } from "@/lib/subflow"
import { type WorkflowNode } from "@/lib/workflow-flow"

export function useSubflowInteraction({
  flow,
  map,
  update,
  catalog,
}: {
  flow: ReactFlowInstance<WorkflowNode, Edge> | null
  map: TaskMap
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
  catalog: Catalog
}) {
  const [groupFormHidden, setGroupFormHidden] = useState(false)
  const [selectingGroup, setSelectingGroup] = useState(false)
  const [groupSelection, setGroupSelection] = useState<string[]>([])
  const [dragPreview, setDragPreview] = useState<{
    entering?: string
    leaving?: string
  }>({})
  const [editingGroup, setEditingGroup] = useState<string | null>(null)

  function groupDrop(node: WorkflowNode) {
    if (node.type !== "task" || !flow) return null
    const parent = node.parentId ? flow.getNode(node.parentId) : undefined
    const position = {
      x: node.position.x + (parent?.position.x ?? 0),
      y: node.position.y + (parent?.position.y ?? 0),
    }
    const width = node.measured?.width ?? node.initialWidth ?? 280
    const height = node.measured?.height ?? node.initialHeight ?? 200
    // Native intersection detection uses flow coordinates, independent of viewport pan/zoom.
    const candidates = new Set(
      flow
        .getIntersectingNodes({
          x: position.x + width / 2 - 1,
          y: position.y + height / 2 - 1,
          width: 2,
          height: 2,
        })
        .filter((n) => n.type === "subflow" && !n.hidden)
        .map((n) => n.id)
    )
    const target = subflowDropTarget(
      (map.subflows ?? []).filter((g) => candidates.has(g.id)),
      { ...position, width, height }
    )
    return { position, target, original: node.parentId }
  }
  function previewGroupDrop(node: WorkflowNode) {
    const info = groupDrop(node)
    const next =
      info && info.target !== info.original
        ? { entering: info.target, leaving: info.original }
        : {}
    setDragPreview((old) =>
      old.entering === next.entering && old.leaving === next.leaving
        ? old
        : next
    )
  }
  function finishGroupDrop(node: WorkflowNode) {
    const info = groupDrop(node)
    if (info)
      update(
        (m) =>
          moveTaskToSubflow(m, catalog, node.id, info.target, info.position),
        "노드 이동"
      )
    setDragPreview({})
  }
  function finishGroupSelection() {
    const ids = (flow?.getNodes() ?? [])
      .filter((n) => n.type === "task" && n.selected && !n.parentId)
      .map((n) => n.id)
    if (!ids.length) return
    setGroupSelection(ids)
    setGroupFormHidden(false)
    setEditingGroup("new")
  }
  function closeGroupEditor() {
    setGroupFormHidden(false)
    setEditingGroup(null)
    setSelectingGroup(false)
    setGroupSelection([])
  }

  return {
    selectingGroup,
    groupSelection,
    editingGroup,
    groupFormHidden,
    setGroupSelection,
    dragPreview,
    closeGroupEditor,
    setDragPreview,
    setGroupFormHidden,
    setSelectingGroup,
    setEditingGroup,
    previewGroupDrop,
    finishGroupDrop,
    finishGroupSelection,
  }
}
