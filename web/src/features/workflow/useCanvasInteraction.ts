import { useMapConnections } from "./useConnections"
import { useSubflowInteraction } from "./useSubflows"
import type { TaskMap } from "@/lib/task-map"
import type { Catalog, Frame } from "@/lib/workbench"
import type { Diagnostic } from "@/lib/diagnostics"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  applyNodeChanges,
  type Edge,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react"
import {
  changeFlowNodes,
  flowEdges,
  flowNodes,
  flowViewport,
  type TaskFlowNode,
  type WorkflowNode,
} from "@/lib/workflow-flow"

const fitOptions = { padding: 0.2, maxZoom: 1 }
export function useTaskMapInteraction({
  map,
  catalog,
  search,
  rows,
  currentIssues,
  update,
  onSelect,
  onEditStart,
  remove,
  removeLink,
  onEditEnd,
  layoutRevision,
  revealNode,
  revealConnection,
}: {
  map: TaskMap
  catalog: Catalog
  search: string
  rows: Frame[]
  currentIssues: Diagnostic[]
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
  onSelect: (() => void) | undefined
  onEditStart: (() => void) | undefined
  remove: (id: string) => void
  removeLink: (id: string) => void
  onEditEnd: (() => void) | undefined
  layoutRevision: number
  revealNode: { id: string; revision: number } | undefined
  revealConnection: { id: string; revision: number } | undefined
}) {
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [edgeActionPosition, setEdgeActionPosition] = useState<{
    x: number
    y: number
  } | null>(null)
  const [flow, setFlow] = useState<ReactFlowInstance<
    WorkflowNode,
    Edge
  > | null>(null)
  const {
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
  } = useSubflowInteraction({ flow, map, update, catalog })
  const [nodeUI, setNodeUI] = useState<
    Record<string, Pick<TaskFlowNode, "measured" | "dragging">>
  >({})
  const previousCount = useRef(map.tasks.length)
  const nodes = useMemo(
    () =>
      flowNodes(map, catalog, search, rows).map((node) => ({
        ...node,
        ...nodeUI[node.id],
        ...(selectingGroup
          ? {
              selected:
                node.type === "task" &&
                groupSelection.includes(node.id) &&
                !node.parentId,
              selectable:
                node.type === "task" &&
                !node.parentId &&
                (editingGroup === null || groupFormHidden),
              draggable: false,
            }
          : {}),
        ...(node.type === "task" && nodeUI[node.id]?.dragging
          ? { zIndex: 2000 }
          : {}),
      })),
    [
      map,
      catalog,
      search,
      rows,
      nodeUI,
      selectingGroup,
      groupSelection,
      editingGroup,
      groupFormHidden,
    ]
  )
  const edges = useMemo(
    () =>
      flowEdges(map, catalog, search).map((edge) => ({
        ...edge,
        className: [
          edge.className,
          currentIssues.some(
            (issue) =>
              issue.connectionId === edge.id && issue.severity === "error"
          )
            ? "workflow-edge-error"
            : currentIssues.some((issue) => issue.connectionId === edge.id)
              ? "workflow-edge-warning"
              : "",
        ]
          .filter(Boolean)
          .join(" "),
        ariaLabel: `${edge.ariaLabel}${currentIssues
          .filter((issue) => issue.connectionId === edge.id)
          .map(
            (issue) =>
              `, ${issue.severity === "error" ? "오류" : "경고"}: ${issue.message}`
          )
          .join("")}`,
        selected: !selectingGroup && selectedEdges.includes(edge.id),
        selectable: !selectingGroup,
      })),
    [map, catalog, search, selectedEdges, selectingGroup, currentIssues]
  )
  const choose = useCallback(
    (id: string) => {
      if (selectingGroup) return
      update((m) => ({ ...m, view: { ...m.view, selected: id } }))
      setSelectedEdges([])
      onSelect?.()
    },
    [update, onSelect, selectingGroup]
  )
  const onNodesChange = useCallback(
    (changes: NodeChange<WorkflowNode>[]) => {
      if (selectingGroup) {
        const selections = changes.filter((c) => c.type === "select")
        if (selections.length)
          setGroupSelection((current) => {
            const next = new Set(current)
            for (const change of selections)
              if (change.type === "select") {
                if (
                  change.selected &&
                  map.tasks.some((t) => t.id === change.id && !t.subflowId)
                )
                  next.add(change.id)
                else next.delete(change.id)
              }
            return [...next]
          })
        changes = changes.filter((c) => c.type !== "select")
      }
      // Preserve measured dimensions across domain updates for fitView and drag.
      // These are transient React Flow state and are never persisted.
      if (
        changes.some((c) => c.type === "dimensions" || c.type === "position")
      ) {
        setNodeUI((current) => {
          const changed = applyNodeChanges(
            changes,
            flowNodes(map, catalog, "", rows).map((node) => ({
              ...node,
              ...current[node.id],
            }))
          )
          return Object.fromEntries(
            changed.map((node) => [
              node.id,
              { measured: node.measured, dragging: node.dragging },
            ])
          )
        })
      }
      if (
        changes.some(
          (c) =>
            c.type === "position" ||
            c.type === "select" ||
            c.type === "dimensions"
        )
      )
        update(
          (m) => changeFlowNodes(m, catalog, changes),
          changes.some((c) => c.type === "dimensions" && c.resizing)
            ? "서브플로우 크기 변경"
            : "노드 이동"
        )
    },
    [update, catalog, map, rows, selectingGroup, setGroupSelection]
  )
  const {
    validateConnection,
    drop,
    finishDrop,
    setDropChoice,
    finishConnection,
    isValidConnection,
    reconnectingRef,
    dropChoice,
  } = useMapConnections({ map, catalog, rows, update, choose })
  // React Flow initiates deletion; domain callbacks preserve frozen results and undo.
  const onBeforeDelete = useCallback(
    async ({
      nodes: deletingNodes,
      edges: deletingEdges,
    }: {
      nodes: WorkflowNode[]
      edges: Edge[]
    }) => {
      const ids = new Set(deletingNodes.map((n) => n.id))
      onEditStart?.()
      try {
        deletingNodes
          .filter((n) => n.type === "task")
          .forEach((n) => remove(n.id))
        deletingEdges
          .filter((e) => !ids.has(e.source) && !ids.has(e.target))
          .forEach((e) => removeLink(e.id))
      } finally {
        onEditEnd?.()
      }
      setSelectedEdges([])
      return false
    },
    [remove, removeLink, onEditStart, onEditEnd]
  )
  useEffect(() => {
    const added = map.tasks.length > previousCount.current
    previousCount.current = map.tasks.length
    if (added && flow) void flow.fitView(fitOptions)
  }, [map.tasks.length, flow])
  const fittedLayout = useRef(0)
  useEffect(() => {
    if (!flow || fittedLayout.current === layoutRevision) return
    const frame = requestAnimationFrame(() => {
      fittedLayout.current = layoutRevision
      void flow.fitView(fitOptions)
    })
    return () => cancelAnimationFrame(frame)
  }, [flow, layoutRevision])
  useEffect(() => {
    if (!flow || !revealNode) return
    const frame = requestAnimationFrame(() => {
      void flow.fitView({
        nodes: [{ id: revealNode.id }],
        padding: 0.35,
        maxZoom: 1,
      })
    })
    return () => cancelAnimationFrame(frame)
  }, [flow, revealNode])
  useEffect(() => {
    if (!revealConnection) return
    const frame = requestAnimationFrame(() =>
      setSelectedEdges([revealConnection.id])
    )
    return () => cancelAnimationFrame(frame)
  }, [revealConnection])
  function revealSelected() {
    if (map.view.selected)
      void flow?.fitView({
        nodes: [{ id: map.view.selected }],
        padding: 0.35,
        maxZoom: 1,
      })
  }
  const [initialViewport] = useState(() => flowViewport(map.view))
  const [shouldFit] = useState(
    () =>
      map.view.coordinateSystem !== "react-flow" &&
      map.view.x === 0 &&
      map.view.y === 0 &&
      map.view.zoom === 1
  )

  return {
    validateConnection,
    drop,
    finishDrop,
    dragPreview,
    setDropChoice,
    closeGroupEditor,
    setDragPreview,
    editingGroup,
    groupSelection,
    groupFormHidden,
    setGroupFormHidden,
    setGroupSelection,
    selectingGroup,
    setSelectingGroup,
    setEditingGroup,
    nodes,
    edges,
    onNodesChange,
    setEdgeActionPosition,
    previewGroupDrop,
    finishGroupDrop,
    finishGroupSelection,
    setSelectedEdges,
    choose,
    finishConnection,
    isValidConnection,
    reconnectingRef,
    onBeforeDelete,
    setFlow,
    initialViewport,
    shouldFit,
    revealSelected,
    selectedEdges,
    edgeActionPosition,
    flow,
    dropChoice,
  }
}
