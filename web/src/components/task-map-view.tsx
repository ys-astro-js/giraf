import { WorkflowToolButton, WorkflowZoomControls, WorkflowEdgeStyleButton } from "./workflow-tools"
import { WorkflowEdge } from "./workflow-edge"
import { customOutput, customPortHandle } from "@/lib/output-ports"
import {groupEqual,groupLabel,matchesGroup,compactPortLabel} from "@/lib/calibration-ports"
import {ccdTasks, calibrationLabels} from "@/lib/calibration"
import { taskDisplayName } from "@/lib/workbench"
import { ArrowRight } from "lucide-react"
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent,
  type CSSProperties,
  type ComponentProps,
} from "react"
import {
  applyNodeChanges,
  ConnectionLineType,
  Background,
  MiniMap,
  NodeResizeControl,
  Handle as FlowHandle,
  Panel,
  Position,
  ReactFlow,
  SelectionMode,
  useNodeId,
  useConnection,
  useStore,
  useUpdateNodeInternals,
  type Connection as FlowConnection,
  type Edge,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from "@xyflow/react"
import {
  Search,
  BroomSparkles,
  LoaderCircle,
  Check,
  Play,
  GripVertical,
  SquareDashedMousePointer,
  Pencil,
  Maximize2,
  LocateFixed,
  Copy,
  Unplug,
  Terminal,
  File,
  X,
  CircleX,
  TriangleAlert,
  CircleDashed,
  Clock3,
  Ban,
  CircleHelp,
} from "lucide-react"
import { diagnostics, type Diagnostic } from "@/lib/diagnostics"
import { toast } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Blank } from "@/components/workbench-controls"
import { type Catalog, type Frame } from "@/lib/workbench"
import { type TaskMap, type Source, stateLabel } from "@/lib/task-map"
import { assigned } from "./task-inspector"
import { SubflowEditor } from "./subflow-editor"
import {
  moveTaskToSubflow,
  subflowDropTarget,
  subflowColor,
} from "@/lib/subflow"
import { WorkflowClickConnection } from "./workflow-click-connection"
import {
  connectionChoices,
  nodeOutput,
  roleActive,
} from "@/lib/node-interaction"
import {
  changeFlowNodes,
  connectFlow,
  connectionFeedback,
  flowEdges,
  flowPortColors,
  flowNodes,
  connectInputPort,
  flowViewport,
  outputHandle,
  type TaskFlowNode,
  type SubflowNode,
  type WorkflowNode,
} from "@/lib/workflow-flow"

const workflowEdgeTypes = { default: WorkflowEdge, smoothstep: WorkflowEdge }

type Props = {
  search?: string
  onSearch?: (value: string) => void
  revealNode?: { id: string; revision: number }
  layoutRevision?: number
  onAutoLayout?: () => void
  onStraightEdges?: () => void
  layoutBusy?: boolean
  map: TaskMap
  catalog: Catalog
  rows: Frame[]
  update: (fn: (m: TaskMap) => TaskMap) => void
  add: () => void
  link: (target?: string, source?: Source) => void
  open: (r: Frame) => void
  removeLink: (id: string) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  onSelect?: () => void
  onInput?: (id: string, role: string) => void
  onRunSubflow?: (id: string) => void
  workflowBusy?: boolean
  runDisabled?: boolean
  revealConnection?: { id: string; revision: number }
}
type DropChoice = { source: Source; target: string; roles: string[] }
type NodeContext = Pick<Props, "map" | "catalog" | "rows" | "onInput" | "duplicate"> & {
  validateConnection: (connection: FlowConnection) => ReturnType<typeof connectionFeedback>
  currentIssues: Diagnostic[]
  edges: Edge[]
  selectingGroup: boolean
  dragPreview: { entering?: string; leaving?: string }
  editGroup: (id: string) => void
  runGroup?: (id: string) => void
  groupRunDisabled?: boolean
  choose: (id: string) => void
  drop: (event: DragEvent, id: string) => void
  dropChoice: DropChoice | null
  finishDrop: (target: string, source: Source, role: string) => void
}
const WorkflowContext = createContext<NodeContext | null>(null)
function ConnectionHandleAnchor({ onClick, ...props }: ComponentProps<typeof FlowHandle>) {
  // Tooltip's click-to-dismiss handler would override React Flow's click connector.
  void onClick
  return <FlowHandle {...props} />
}
function Handle(props: ComponentProps<typeof FlowHandle>) {
  const { validateConnection, edges } = useContext(WorkflowContext)!
  const from = useConnection(state => state.inProgress ? state.fromHandle : null)
  // Handles receive their node id from React Flow's enclosing node context.
  const nodeId = useNodeId()!
  const colors = flowPortColors(edges, nodeId, props.type, props.id)
  const portFill = colors.length === 1 ? colors[0] : colors.length > 1
    ? `conic-gradient(${colors.map((color, index) => `${color} ${index * 100 / colors.length}% ${(index + 1) * 100 / colors.length}%`).join(", ")})` : undefined
  const near = useConnection(state => state.inProgress && state.toHandle?.nodeId === nodeId &&
    state.toHandle?.id === props.id && state.toHandle?.type === props.type)
  const [hovered, setHovered] = useState(false)
  const feedback = useMemo(() => {
    if (!from || from.type === props.type) return null
    const source = from.type === "source" ? from : {nodeId, id: props.id}
    const target = from.type === "target" ? from : {nodeId, id: props.id}
    return validateConnection({source: source.nodeId, sourceHandle: source.id ?? null, target: target.nodeId, targetHandle: target.id ?? null})
  }, [from, nodeId, props.id, props.type, validateConnection])
  const isOrigin = from?.nodeId === nodeId && from.id === props.id && from.type === props.type
  const state = feedback ? (feedback.valid ? "available" : "unavailable") : isOrigin ? "origin" : from ? "irrelevant" : undefined
  return <Tooltip open={!!feedback && !feedback.valid && (near || hovered)}>
    <TooltipTrigger render={<ConnectionHandleAnchor {...props}
      data-connection-state={state}
      data-highlighted={!!portFill}
      aria-label={`${props["aria-label"] ?? "포트"}${feedback ? `: ${feedback.valid ? "연결 가능" : "연결 불가"}` : ""}`}
      title={from ? undefined : props.title}
      style={{...props.style, "--workflow-port-fill": portFill, ...(feedback ? {pointerEvents: "all"} : {})} as CSSProperties}
      onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}>
      {feedback && !feedback.valid ? <><span className="connection-port-symbol" aria-hidden="true"><Ban /></span>{props.children && props.type === "source" && <span className="connection-port-name">{props.children}</span>}</> : props.children}
    </ConnectionHandleAnchor>} />
    <TooltipContent className="pointer-events-none" side={props.type === "target" ? "left" : "right"}>
      <span className="connection-port-feedback" role="status">
        {!feedback?.valid && feedback?.message}
      </span>
    </TooltipContent>
  </Tooltip>
}
const TaskNode = memo(function TaskNode({
  id,
  data,
  selected,
  dragging,
  isConnectable,
}: NodeProps<TaskFlowNode>) {
  const {
    map,
    catalog,
    rows,
    choose,
    duplicate,
    onInput,
    drop,
    dropChoice,
    finishDrop,
    selectingGroup,
    currentIssues,
  } = useContext(WorkflowContext)!
  const { task, geometry } = data
  const nodeIssues = currentIssues.filter(issue => issue.nodeId === id)
  const nodeIssue = nodeIssues.find(issue => issue.severity === "error") || nodeIssues[0]
  const spec = catalog.tasks.find((s) => s.name === task.task)
  const sourceConnections = map.connections.filter(
    (connection) => connection.source.kind !== "files" && connection.source.taskId === id
  )
  const isOutputConnected = (handle: string) => sourceConnections.some(
    (connection) => outputHandle(connection.source, spec) === handle
  )
  const run = map.runs.filter((r) => r.instanceId === id).at(-1)
  const nodeStatus = nodeIssue
    ? `${nodeIssue.severity === "error" ? "오류" : "경고"}: ${nodeIssues.map(issue => issue.message).join("; ")}`
    : run ? stateLabel(run.state) : "실행 전"
  const output = nodeOutput(map, id, geometry.primaryOutputRole)
  const primaryName = task.outputPorts?.find(p=>p.id==="$default")?.name.trim() || ""
  const clickStart = useStore((state) => state.connectionClickStartHandle)
  const connecting = useConnection(state => state.inProgress)
  const connectionTarget = useConnection((connection) =>
    connection.inProgress && connection.isValid && connection.toNode?.id === id
      ? (connection.toHandle?.id ?? null)
      : null
  )
  const inputHandles = useRef(new Map<string, HTMLDivElement>())
  const updateNodeInternals = useUpdateNodeInternals()
  const handlesKey = [primaryName,String(geometry.primaryOutputRole),String(geometry.width),...geometry.roles.map((s) => s.name),...geometry.outputs.map(s=>s.handleId+":"+s.name)].join("|")
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handlesKey, updateNodeInternals])
  return (
    <article
      className="workflow-node"
      style={{minHeight:geometry.height}}
      data-node-id={id}
      aria-label={`${task.label} 노드`}
      data-selected={selected}
      data-group-selected={selectingGroup && selected}
      data-running={run?.state === "running"}
      data-dragging={dragging}
      data-connection-target={connectionTarget !== null}
      data-diagnostic={nodeIssue?.severity}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => drop(e, id)}
    >
      <header className="node-header">
        <button
          className="node-heading"
          aria-label={`${task.label} 이동`}
          aria-pressed={selected}
          onClick={() => choose(id)}
        >
          <GripVertical aria-hidden="true" />
          <span className="node-title">
            <strong title={task.task}>
              {task.label === task.task ? taskDisplayName(task.task) : task.label || taskDisplayName(task.task)}
            </strong>
            <span title={task.description ?? spec?.description ?? spec?.title}>
              {task.description ?? spec?.description ?? spec?.title}
            </span>
          </span>
        </button>
        <Button
          className="node-duplicate nodrag nopan"
          size="icon-sm"
          variant="ghost"
          aria-label={`${task.label} 복제`}
          title="노드 복제"
          onClick={(e) => {
            e.stopPropagation()
            duplicate(id)
          }}
        >
          <Copy />
        </Button>
      </header>
      <div className="node-inputs">
        {geometry.roles.length ? (
          geometry.roles.map((slot) => {
            const assignedRole = assigned(map, task, slot.role)
            const allRows=[...rows,...map.runs.flatMap(r=>r.products)]
            const a = slot.group ? {...assignedRole,ids:assignedRole.ids.filter(id=>{const frame=allRows.find(r=>r.id===id);return frame&&(frame.asset==="image-list"||matchesGroup(frame,slot.group!))})} : assignedRole
            const links = map.connections.filter(
              (c) => c.target === id && c.role === slot.role &&
                (c.source.kind !== 'files' || c.source.ids.length>0) &&
                (!slot.group || !c.targetGroup || groupEqual(slot.group,c.targetGroup))
            )
            const summary =
              (task.draft.textInputs?.[slot.name]?.trim() ? "직접 입력 " + task.draft.textInputs[slot.name].trim().split("\n").length + "행" : "") ||
              (task.draft.cursorCommands?.[slot.role]?.trim() ? "커서 명령 " + task.draft.cursorCommands[slot.role].trim().split("\n").length + "행" : "") || task.expressions[slot.role] ||
              (links.length
                ? links
                    .map((c) =>
                      c.source.kind === "files"
                        ? `파일 ${slot.group ? c.source.ids.filter(id=>{const frame=allRows.find(r=>r.id===id);return frame&&matchesGroup(frame,slot.group!)}).length : c.source.ids.length}개`
                        : map.tasks.find(
                            (t) =>
                              t.id ===
                              ("taskId" in c.source
                                ? c.source.taskId
                                : undefined)
                          )?.label || "실행 결과"
                    )
                    .join(", ")
                : a.ids.length === 1
                  ? rows.find((f) => f.id === a.ids[0])?.label || "파일 1개"
                  : a.ids.length
                    ? `파일 ${a.ids.length}개`
                    : "미지정")
            const enabled = roleActive(task, slot.role, catalog)
            const pickable =
              dropChoice?.target === id && dropChoice.roles.includes(slot.name)
            return (
              <div
                className="node-input-row"
                data-grouped={!!slot.group}
                key={slot.name}
                data-inactive={!enabled}
                data-connection-target={connectionTarget === slot.name}
              >
                <Handle
                  ref={(element) => {
                    if (element) inputHandles.current.set(slot.name, element)
                    else inputHandles.current.delete(slot.name)
                  }}
                  data-connected={links.length > 0}
                  role="button"
                  tabIndex={enabled && isConnectable ? 0 : -1}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      e.stopPropagation()
                      e.currentTarget.click()
                    }
                  }}
                  type="target"
                  position={Position.Left}
                  id={slot.name}
                  style={{ top: geometry.inputY[slot.name] }}
                  isConnectable={isConnectable && enabled}
                  data-filter={slot.group?.filter || undefined}
                  className={`workflow-input-handle${slot.group ? " workflow-group-handle" : ""}`}
                  aria-label={`${task.label} ${slot.role} ${slot.group ? groupLabel(slot.group)+" " : ""}입력 연결`}
                >{slot.group && <span>{compactPortLabel(slot.group)}</span>}</Handle>
                <Tooltip disabled={connecting}>
                  <TooltipTrigger render={<button />}
                    className="node-input nodrag nopan"
                    data-input-role={slot.name}
                    data-connection-choice={!!pickable}
                    aria-label={`${task.label} ${slot.role} ${slot.group ? groupLabel(slot.group) : ""}${pickable ? "에 연결" : " 설정"}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (clickStart) {
                        if (enabled && isConnectable) inputHandles.current.get(slot.name)?.click()
                      }
                      else if (pickable && dropChoice)
                        finishDrop(id, dropChoice.source, slot.name)
                      else {
                        choose(id)
                        onInput?.(id, slot.name)
                      }
                    }}
                  >
                    <span className="node-input-label">
                      {!slot.group && (ccdTasks.has(task.task) ? calibrationLabels[slot.role] || slot.role : slot.role)}
                      {!enabled && <span> 비활성</span>}
                    </span>
                    <span className="node-input-source" title={summary}>
                      {links.some(c=>c.source.kind==="pending") ? `${summary} 출력 대기` : summary}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{slot.label || slot.name}</TooltipContent>
                </Tooltip>
              </div>
            )
          })
        ) : (
          <p className="node-no-input">입력 없음</p>
        )}
      </div>
      <div className="node-footer">
        <span className="node-state" data-severity={nodeIssue?.severity} data-failed={!nodeIssue && run?.state === "failed"} role="img" aria-label={nodeStatus} title={nodeStatus}>
          {nodeIssue?.severity === "error" ? <CircleX aria-hidden="true" />
            : nodeIssue ? <TriangleAlert aria-hidden="true" />
            : run?.state === "running" || run?.state === "queued" ? <LoaderCircle className="node-running-icon" aria-hidden="true" />
            : run?.state === "completed" ? <Check aria-hidden="true" />
            : run?.state === "waiting" ? <Clock3 aria-hidden="true" />
            : run?.state === "failed" ? <CircleX aria-hidden="true" />
            : run?.state === "cancelled" ? <Ban aria-hidden="true" />
            : run ? <CircleHelp aria-hidden="true" />
            : <CircleDashed aria-hidden="true" />}
        </span>
        
        {output.kind === "result" && (
          <span className="node-output-summary" aria-label={`${output.ids.length}개 항목`}>
            <File aria-hidden="true" /><span>{output.ids.length}</span>
          </span>
        )}
        <Handle type="source" position={Position.Right} id="output"
          role="button" tabIndex={isConnectable ? 0 : -1}
          aria-label={`${task.label} ${primaryName ? primaryName+" " : ""}출력 연결`} title={primaryName || "기본 출력 연결"}
          isConnectable={isConnectable} className={`workflow-output-handle${primaryName ? " workflow-named-port" : ""}`}
          style={{top:geometry.outputY,left:geometry.outputX,bottom:"auto",transform:"translate(-50%, -50%)"}}
          data-connected={isOutputConnected("output")}
          onKeyDown={e=>{if(e.key === "Enter" || e.key === " "){e.preventDefault();e.stopPropagation();e.currentTarget.click()}}}>
          {primaryName ? <span>{primaryName}</span> : <ArrowRight aria-hidden="true"/>}
        </Handle>
      </div>

      {geometry.outputs.map(slot => {
        const custom=task.outputPorts?.find(p=>customPortHandle(p.id)===slot.handleId)
        const result=custom ? customOutput(map,id,custom) : nodeOutput(map,id,slot.outputRole,slot.group)
        const name=slot.name.trim()
        return <Handle key={slot.handleId} type="source" position={Position.Right} id={slot.handleId}
          style={{top:slot.y,left:slot.x,bottom:'auto',transform:'translate(-50%, -50%)'}}
          isConnectable={isConnectable}
          className={`workflow-output-handle workflow-right-port${name ? " workflow-named-port" : ""}`}
          data-connected={isOutputConnected(slot.handleId)}
          role="button" tabIndex={isConnectable?0:-1}
          aria-label={`${task.label} ${name || "이름 없는 포트"} 출력 연결`}
          title={`${name || "출력"} — ${result.kind === "result" ? result.ids.length+"개" : "출력 대기"}`}
          onKeyDown={e=>{if(e.key === "Enter" || e.key === " "){e.preventDefault();e.stopPropagation();e.currentTarget.click()}}}>
          {name ? <span>{name}</span> : <ArrowRight aria-hidden="true"/>}
        </Handle>
      })}

    </article>
  )
})
// Stable nodeTypes avoid remounting nodes during edits.
const GroupNode = memo(function GroupNode({ data }: NodeProps<SubflowNode>) {
  const { editGroup, runGroup, groupRunDisabled, dragPreview } =
    useContext(WorkflowContext)!
  return (
    <section
      className="subflow-node"
      aria-label={data.group.name}
      data-drop-state={
        dragPreview.leaving === data.group.id
          ? "leaving"
          : dragPreview.entering === data.group.id
            ? "entering"
            : undefined
      }
      style={
        { "--group-color": subflowColor(data.group.color) } as CSSProperties
      }
    >
      <header className="subflow-heading">
        <GripVertical aria-hidden="true" />
        <strong title={data.group.name}>{data.group.name}</strong>
        <Button
          className="nodrag nopan"
          variant="ghost"
          size="icon-sm"
          aria-label={`${data.group.name} 편집`}
          onClick={() => editGroup(data.group.id)}
        >
          <Pencil />
        </Button>
        <span className="group-task-count" aria-label={`${data.count}개 작업`}>
          <Terminal aria-hidden="true" /><span>{data.count}</span>
        </span>
        <Button
          className="nodrag nopan subflow-run-button"
          variant="default"
          size="icon"
          aria-label={`${data.group.name} 실행`}
          title={`${data.group.name} 실행`}
          disabled={groupRunDisabled || !data.count || !runGroup}
          onClick={() => runGroup?.(data.group.id)}
        >
          <Play />
        </Button>
      </header>
      <NodeResizeControl
        minWidth={data.minWidth}
        minHeight={data.minHeight}
        aria-label={`${data.group.name} 크기 조절`}
        className="subflow-resize"
      >
        <Maximize2 aria-hidden="true" />
      </NodeResizeControl>
    </section>
  )
})
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
  removeLink,
  remove,
  duplicate,
  onSelect,
  onInput,
  onRunSubflow,
  workflowBusy,
  runDisabled,
}: Props) {
  const diagnosticEntries = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot, diagnostics.getSnapshot)
  const currentIssues = useMemo(() => diagnosticEntries.filter(entry => entry.current), [diagnosticEntries])
  const [groupFormHidden, setGroupFormHidden] = useState(false)
  const [selectingGroup, setSelectingGroup] = useState(false)
  const [groupSelection, setGroupSelection] = useState<string[]>([])
  const [dragPreview, setDragPreview] = useState<{
    entering?: string
    leaving?: string
  }>({})
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [selectedEdges, setSelectedEdges] = useState<string[]>([])
  const [edgeActionPosition, setEdgeActionPosition] = useState<{ x: number; y: number } | null>(null)
  const [dropChoice, setDropChoice] = useState<DropChoice | null>(null)
  const [flow, setFlow] = useState<ReactFlowInstance<
    WorkflowNode,
    Edge
  > | null>(null)
  const [nodeUI, setNodeUI] = useState<
    Record<string, Pick<TaskFlowNode, "measured" | "dragging">>
  >({})
  const previousCount = useRef(map.tasks.length)
  const reconnecting = useRef<string | undefined>(undefined)
  const nodes = useMemo(
    () =>
      flowNodes(map, catalog, search,rows).map((node) => ({
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
        className: [edge.className, currentIssues.some(issue => issue.connectionId === edge.id && issue.severity === "error") ? "workflow-edge-error" : currentIssues.some(issue => issue.connectionId === edge.id) ? "workflow-edge-warning" : ""].filter(Boolean).join(" "),
        ariaLabel: `${edge.ariaLabel}${currentIssues.filter(issue => issue.connectionId === edge.id).map(issue => `, ${issue.severity === "error" ? "오류" : "경고"}: ${issue.message}`).join("")}`,
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
            flowNodes(map, catalog,"",rows).map((node) => ({
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
        update((m) => changeFlowNodes(m, catalog, changes))
    },
    [update, catalog, map, rows, selectingGroup]
  )
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
      update((m) =>
        moveTaskToSubflow(m, catalog, node.id, info.target, info.position)
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
  const validateConnection = useCallback(
    (connection: FlowConnection) => connectionFeedback(map, catalog, rows, connection, reconnecting.current),
    [map, catalog, rows]
  )
  const isValidConnection = useCallback(
    (connection: FlowConnection | Edge) => validateConnection({
      ...connection,
      sourceHandle: connection.sourceHandle ?? null,
      targetHandle: connection.targetHandle ?? null,
    }).valid,
    [validateConnection]
  )
  function finishConnection(connection: FlowConnection, replacingId?: string) {
    try {
      const next = connectFlow(map, catalog, rows, connection, replacingId)
      update(() => next)
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  function finishDrop(target: string, source: Source, role: string) {
    try {
      const next = connectInputPort(map,catalog,rows,target,role,source,true)
      update(() => next)
      setDropChoice(null)
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  function drop(event: DragEvent, target: string) {
    event.preventDefault()
    event.stopPropagation()
    const raw = event.dataTransfer.getData("application/giraf-source")
    if (!raw) return
    try {
      const source: Source = JSON.parse(raw)
      const roles = connectionChoices(map, catalog, source, target, rows)
      const role = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-input-role]"
      )?.dataset.inputRole
      if (role || roles.length === 1)
        finishDrop(target, source, role ?? roles[0].name)
      else {
        setDropChoice({ source, target, roles: roles.map((s) => s.name) })
        choose(target)
      }
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
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
      deletingNodes
        .filter((n) => n.type === "task")
        .forEach((n) => remove(n.id))
      deletingEdges
        .filter((e) => !ids.has(e.source) && !ids.has(e.target))
        .forEach((e) => removeLink(e.id))
      setSelectedEdges([])
      return false
    },
    [remove, removeLink]
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
      void flow.fitView({ nodes: [{ id: revealNode.id }], padding: 0.35, maxZoom: 1 })
    })
    return () => cancelAnimationFrame(frame)
  }, [flow, revealNode])
  useEffect(() => {
    if (!revealConnection) return
    const frame = requestAnimationFrame(() => setSelectedEdges([revealConnection.id]))
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
              connectionLineType={map.view.edgeStyle === "smoothstep" ? ConnectionLineType.SmoothStep : ConnectionLineType.Bezier}
              onNodesChange={onNodesChange}
              onEdgeClick={(event) => {
                const bounds = (event.currentTarget as Element).closest(".react-flow")?.getBoundingClientRect()
                if (!bounds) return
                const edgeBounds = (event.currentTarget as Element).getBoundingClientRect()
                const x = event.clientX || edgeBounds.x + edgeBounds.width / 2
                const y = event.clientY || edgeBounds.y + edgeBounds.height / 2
                setEdgeActionPosition({
                  x: Math.max(8, Math.min(x - bounds.x + 12, bounds.width - 40)),
                  y: Math.max(8, Math.min(y - bounds.y + 12, bounds.height - 40)),
                })
              }}
              onMoveStart={() => setEdgeActionPosition(null)}
              onNodeDragStart={(_, node) => previewGroupDrop(node)}
              onNodeDrag={(_, node) => previewGroupDrop(node)}
              onNodeDragStop={(_, node) => finishGroupDrop(node)}
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
                  update(m => ({ ...m, view: { ...m.view, selected: "" } }))
              }}
              onConnect={(connection) => finishConnection(connection)}
              isValidConnection={isValidConnection}
              onReconnectStart={(_, edge) => {
                reconnecting.current = edge.id
              }}
              onReconnect={(edge, connection) =>
                finishConnection(connection, edge.id)
              }
              onReconnectEnd={() => {
                reconnecting.current = undefined
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
              <Panel position="bottom-left" className="workflow-tools" role="group" aria-label="워크플로우 도구">
                <WorkflowZoomControls />
                <ButtonGroup orientation="vertical" aria-label="워크플로우 구성">
                  <WorkflowEdgeStyleButton
                    straight={map.view.edgeStyle === "smoothstep"}
                    disabled={layoutBusy || !onStraightEdges}
                    onClick={() => {
                      if (map.view.edgeStyle === "smoothstep")
                        update(m => ({ ...m, view: { ...m.view, edgeStyle: "default" } }))
                      else onStraightEdges?.()
                    }}
                  />
                  <WorkflowToolButton variant="outline" size="icon-sm"
                    label="선택한 작업 보기"
                    disabled={!map.view.selected}
                    onClick={revealSelected}
                  >
                    <LocateFixed />
                  </WorkflowToolButton>
                  <WorkflowToolButton variant="outline" size="icon-sm"
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
                  <WorkflowToolButton variant="outline" size="icon-sm"
                    label={layoutBusy ? "배치 중…" : "자동 배치"}
                    onClick={onAutoLayout}
                    disabled={layoutBusy || !onAutoLayout}
                    aria-busy={layoutBusy}
                  >
                    {layoutBusy ? <LoaderCircle className="animate-spin" /> : <BroomSparkles />}
                  </WorkflowToolButton>
                </ButtonGroup>
              </Panel>
              {selectingGroup && (editingGroup === null || groupFormHidden) && (
                <Panel position="top-center" className="subflow-selection-bar">
                  <span role="status">
                    {groupSelection.length
                      ? <span className="group-task-count" aria-label={`${groupSelection.length}개 작업`}><Terminal aria-hidden="true" /><span>{groupSelection.length}</span></span>
                      : "그룹에 넣을 작업을 드래그해 선택하세요."}
                  </span>
                </Panel>
              )}
              {!selectingGroup && !!selectedEdges.length && edgeActionPosition && (
                <Panel position="top-left" style={{ left: edgeActionPosition.x, top: edgeActionPosition.y, margin: 0 }}>
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
