import { useTaskMapInteraction } from "./useCanvasInteraction"
import type { TaskMapViewProps } from "./types"
import { WorkflowContext } from "./context"
import { TaskNode } from "./TaskNode"
import { GroupNode } from "./GroupNode"
import {
  WorkflowToolButton,
  WorkflowZoomControls,
  WorkflowEdgeStyleButton,
} from "@/components/workflow-tools"
import { WorkflowEdge } from "@/components/workflow-edge"
import { useMemo, useSyncExternalStore } from "react"
import {
  ConnectionLineType,
  Background,
  MiniMap,
  Panel,
  ReactFlow,
  SelectionMode,
  type Edge,
} from "@xyflow/react"
import {
  Search,
  BroomSparkles,
  LoaderCircle,
  SquareDashedMousePointer,
  LocateFixed,
  Unplug,
  Terminal,
  X,
} from "lucide-react"
import { diagnostics } from "@/lib/diagnostics"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import { Blank } from "@/components/workbench-controls"
import { SubflowEditor } from "@/components/subflow-editor"
import { subflowColor } from "@/lib/subflow"
import { WorkflowClickConnection } from "@/components/workflow-click-connection"
import { type SubflowNode, type WorkflowNode } from "@/lib/workflow-flow"

const workflowEdgeTypes = { default: WorkflowEdge, smoothstep: WorkflowEdge }

const nodeTypes = { task: TaskNode, subflow: GroupNode }
const fitOptions = { padding: 0.2, maxZoom: 1 }
const ariaLabelConfig = {
  "controls.zoomIn.ariaLabel": "확대",
  "controls.zoomOut.ariaLabel": "축소",
  "controls.fitView.ariaLabel": "전체 보기",
  "controls.interactive.ariaLabel": "편집 잠금 전환",
  "node.a11yDescription.default":
    "Enter 또는 Space로 선택하고 방향키로 이동합니다. Delete로 삭제하고 Escape로 선택을 해제합니다.",
  "edge.a11yDescription.default":
    "Enter 또는 Space로 연결을 선택하고 Delete로 해제합니다. Escape로 선택을 해제합니다.",
}
export function TaskMapView({
  search = "",
  onSearch,
  layoutRevision = 0,
  revealNode,
  revealConnection,
  onAutoLayout,
  onStraightEdges,
  layoutBusy = false,
  map,
  catalog,
  rows,
  update,
  onEditStart,
  onEditEnd,
  removeLink,
  remove,
  duplicate,
  onSelect,
  onInput,
  onRunSubflow,
  workflowBusy,
  runDisabled,
}: TaskMapViewProps) {
  const diagnosticEntries = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.getSnapshot,
    diagnostics.getSnapshot
  )
  const currentIssues = useMemo(
    () => diagnosticEntries.filter((entry) => entry.current),
    [diagnosticEntries]
  )
  const {
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
    validateConnection,
    drop,
    finishDrop,
    dragPreview,
  } = useTaskMapInteraction({
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
  })
  return (
    <section
      className="map-workspace"
      aria-label="워크플로우"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          setDropChoice(null)
          closeGroupEditor()
          setDragPreview({})
        }
      }}
    >
      <h1 className="sr-only">워크플로우</h1>
      {onSearch && (
        <div className="workflow-search">
          <InputGroup>
            <InputGroupInput
              className="h-full"
              aria-label="작업 검색"
              placeholder="작업 검색"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
            <InputGroupAddon>
              <Search aria-hidden="true" />
            </InputGroupAddon>
          </InputGroup>
        </div>
      )}
      {editingGroup !== null && (
        <SubflowEditor
          key={editingGroup}
          map={map}
          catalog={catalog}
          group={map.subflows?.find((g) => g.id === editingGroup)}
          update={update}
          taskIds={groupSelection.filter((id) =>
            map.tasks.some((t) => t.id === id && !t.subflowId)
          )}
          hidden={editingGroup === "new" && groupFormHidden}
          reselect={() => {
            setGroupFormHidden(true)
            setGroupSelection([])
          }}
          close={closeGroupEditor}
        />
      )}
      {!map.tasks.length ? (
        <Blank>사이드바에서 작업을 추가하세요</Blank>
      ) : (
        <div
          className="map-viewport"
          aria-label="워크플로우 캔버스"
          data-group-selecting={selectingGroup}
        >
          <WorkflowContext.Provider
            value={{
              map,
              validateConnection,
              currentIssues,
              edges,
              catalog,
              rows,
              choose,
              duplicate,
              onInput: selectingGroup ? undefined : onInput,
              drop,
              dropChoice,
              finishDrop,
              selectingGroup,
              dragPreview,
              beginEdit: onEditStart,
              endEdit: onEditEnd,
              editGroup: (id) => {
                setSelectingGroup(false)
                setGroupFormHidden(false)
                setGroupSelection([])
                setEditingGroup(id)
              },
              runGroup: onRunSubflow,
              groupRunDisabled: workflowBusy || runDisabled,
            }}
          >
            <ReactFlow<WorkflowNode, Edge>
              connectOnClick={true}
              proOptions={{ hideAttribution: true }}
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              edgeTypes={workflowEdgeTypes}
              // Groups < edges < task nodes/ports, including selected edges and grouped tasks.
              zIndexMode="manual"
              connectionLineType={
                map.view.edgeStyle === "smoothstep"
                  ? ConnectionLineType.SmoothStep
                  : ConnectionLineType.Bezier
              }
              onNodesChange={onNodesChange}
              onEdgeClick={(event) => {
                const bounds = (event.currentTarget as Element)
                  .closest(".react-flow")
                  ?.getBoundingClientRect()
                if (!bounds) return
                const edgeBounds = (
                  event.currentTarget as Element
                ).getBoundingClientRect()
                const x = event.clientX || edgeBounds.x + edgeBounds.width / 2
                const y = event.clientY || edgeBounds.y + edgeBounds.height / 2
                setEdgeActionPosition({
                  x: Math.max(
                    8,
                    Math.min(x - bounds.x + 12, bounds.width - 40)
                  ),
                  y: Math.max(
                    8,
                    Math.min(y - bounds.y + 12, bounds.height - 40)
                  ),
                })
              }}
              onMoveStart={() => setEdgeActionPosition(null)}
              onNodeDragStart={(_, node) => {
                onEditStart?.()
                previewGroupDrop(node)
              }}
              onNodeDrag={(_, node) => previewGroupDrop(node)}
              onNodeDragStop={(_, node) => {
                finishGroupDrop(node)
                onEditEnd?.()
              }}
              onSelectionEnd={() => {
                if (selectingGroup) finishGroupSelection()
              }}
              selectionOnDrag={
                selectingGroup && (editingGroup === null || groupFormHidden)
              }
              selectionMode={SelectionMode.Partial}
              panOnDrag={selectingGroup ? [1, 2] : true}
              selectionKeyCode={selectingGroup ? null : "Shift"}
              nodesConnectable={!selectingGroup}
              edgesFocusable={!selectingGroup}
              selectNodesOnDrag={!selectingGroup}
              onEdgesChange={(changes) =>
                setSelectedEdges((current) => {
                  const next = new Set(current)
                  for (const change of changes)
                    if (change.type === "select") {
                      if (change.selected) next.add(change.id)
                      else next.delete(change.id)
                    }
                  return [...next]
                })
              }
              onNodeClick={(event, node) => {
                if (
                  node.type === "task" &&
                  !(event.target as Element).closest(".react-flow__handle")
                )
                  choose(node.id)
              }}
              onPaneClick={() => {
                setDropChoice(null)
                setEdgeActionPosition(null)
                setSelectedEdges([])
                if (!selectingGroup)
                  update((m) => ({ ...m, view: { ...m.view, selected: "" } }))
              }}
              onConnect={(connection) => finishConnection(connection)}
              isValidConnection={isValidConnection}
              onReconnectStart={(_, edge) => {
                reconnectingRef.current = edge.id
              }}
              onReconnect={(edge, connection) =>
                finishConnection(connection, edge.id)
              }
              onReconnectEnd={() => {
                reconnectingRef.current = undefined
              }}
              onBeforeDelete={onBeforeDelete}
              onInit={setFlow}
              defaultViewport={initialViewport}
              fitView={shouldFit}
              fitViewOptions={fitOptions}
              onMoveEnd={(_, viewport) =>
                update((m) => ({
                  ...m,
                  view: {
                    ...m.view,
                    ...viewport,
                    coordinateSystem: "react-flow",
                  },
                }))
              }
              minZoom={0.1}
              maxZoom={2}
              deleteKeyCode={["Backspace", "Delete"]}
              multiSelectionKeyCode={
                selectingGroup ? ["Shift", "Meta", "Control"] : null
              }
              ariaLabelConfig={ariaLabelConfig}
            >
              <Background gap={24} size={1} />
              <MiniMap
                style={{ width: 120, height: 80 }}
                pannable
                zoomable
                ariaLabel="워크플로우 미니맵"
                nodeColor={(node) =>
                  node.type === "subflow"
                    ? subflowColor((node as SubflowNode).data.group.color)
                    : "var(--foreground)"
                }
                nodeStrokeColor="var(--border)"
                nodeBorderRadius={6}
                maskColor="var(--workflow-minimap-mask)"
              />
              <WorkflowClickConnection />
              <Panel
                position="bottom-left"
                className="workflow-tools"
                role="group"
                aria-label="워크플로우 도구"
              >
                <WorkflowZoomControls />
                <ButtonGroup
                  orientation="vertical"
                  aria-label="워크플로우 구성"
                >
                  <WorkflowEdgeStyleButton
                    straight={map.view.edgeStyle === "smoothstep"}
                    disabled={layoutBusy || !onStraightEdges}
                    onClick={() => {
                      if (map.view.edgeStyle === "smoothstep")
                        update(
                          (m) => ({
                            ...m,
                            view: { ...m.view, edgeStyle: "default" },
                          }),
                          "연결선 모양 변경"
                        )
                      else onStraightEdges?.()
                    }}
                  />
                  <WorkflowToolButton
                    variant="outline"
                    size="icon-sm"
                    label="선택한 작업 보기"
                    disabled={!map.view.selected}
                    onClick={revealSelected}
                  >
                    <LocateFixed />
                  </WorkflowToolButton>
                  <WorkflowToolButton
                    variant="outline"
                    size="icon-sm"
                    label="그룹 만들기"
                    aria-pressed={selectingGroup}
                    disabled={!map.tasks.some((t) => !t.subflowId)}
                    onClick={() => {
                      setEditingGroup(null)
                      setSelectingGroup((v) => !v)
                      setSelectedEdges([])
                      setGroupSelection([])
                    }}
                  >
                    <SquareDashedMousePointer />
                  </WorkflowToolButton>
                  <WorkflowToolButton
                    variant="outline"
                    size="icon-sm"
                    label={layoutBusy ? "배치 중…" : "자동 배치"}
                    onClick={onAutoLayout}
                    disabled={layoutBusy || !onAutoLayout}
                    aria-busy={layoutBusy}
                  >
                    {layoutBusy ? (
                      <LoaderCircle className="animate-spin" />
                    ) : (
                      <BroomSparkles />
                    )}
                  </WorkflowToolButton>
                </ButtonGroup>
              </Panel>
              {selectingGroup && (editingGroup === null || groupFormHidden) && (
                <Panel position="top-center" className="subflow-selection-bar">
                  <span role="status">
                    {groupSelection.length ? (
                      <span
                        className="group-task-count"
                        aria-label={`${groupSelection.length}개 작업`}
                      >
                        <Terminal aria-hidden="true" />
                        <span>{groupSelection.length}</span>
                      </span>
                    ) : (
                      "그룹에 넣을 작업을 드래그해 선택하세요."
                    )}
                  </span>
                </Panel>
              )}
              {!selectingGroup &&
                !!selectedEdges.length &&
                edgeActionPosition && (
                  <Panel
                    position="top-left"
                    style={{
                      left: edgeActionPosition.x,
                      top: edgeActionPosition.y,
                      margin: 0,
                    }}
                  >
                    <WorkflowToolButton
                      variant="outline"
                      size="icon-sm"
                      label="연결 해제"
                      onClick={() => {
                        void flow?.deleteElements({
                          edges: selectedEdges.map((id) => ({ id })),
                        })
                        setEdgeActionPosition(null)
                      }}
                    >
                      <Unplug />
                    </WorkflowToolButton>
                  </Panel>
                )}
              {!nodes.some((n) => !n.hidden) && (
                <Panel position="top-center">
                  <Blank>검색 결과가 없습니다</Blank>
                </Panel>
              )}
              {dropChoice && (
                <Panel position="top-center">
                  <div className="workflow-drop-choice" role="status">
                    연결할 입력을 선택하세요
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="입력 연결 취소"
                      onClick={() => setDropChoice(null)}
                    >
                      <X />
                    </Button>
                  </div>
                </Panel>
              )}
            </ReactFlow>
          </WorkflowContext.Provider>
        </div>
      )}
    </section>
  )
}
