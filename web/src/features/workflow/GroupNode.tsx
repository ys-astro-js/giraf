import { memo, useContext, useEffect, type CSSProperties } from "react"
import { NodeResizeControl, Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { Play, GripVertical, Pencil, Maximize2, Terminal, ChevronsDownUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { subflowColor } from "@/lib/subflow"
import { flowProgress } from "@/lib/containers"
import { type SubflowNode } from "@/lib/workflow-flow"

import { WorkflowContext } from "./context"
import { Handle } from "./Handle"
export const GroupNode = memo(function GroupNode({
  id,
  data,
  selected,
  isConnectable,
}: NodeProps<SubflowNode>) {
  const {
    map,
    editGroup,
    runGroup,
    groupRunDisabled,
    dragPreview,
    beginEdit,
    endEdit,
    setGroupCollapsed,
    choose,
    flowProgress: progress,
  } = useContext(WorkflowContext)!
  const { flow } = data
  // A container's heading is its name, then what it does (`M67 FILTER별로`).
  const name = flow?.label ?? data.group.name
  const meta = flowProgress(flow?.run, progress?.id === id ? progress : undefined)
  const updateNodeInternals = useUpdateNodeInternals()
  const handlesKey = flow?.ports.map((port) => `${port.handleId}@${port.x},${port.y}`).join("|")
  useEffect(() => {
    if (handlesKey !== undefined) updateNodeInternals(id)
  }, [id, handlesKey, updateNodeInternals])
  // Source handles are `output:<role>` or `value:<name>`; connections store the role.
  const connected = (handleId: string, type: "source" | "target") =>
    map.connections.some((c) =>
      type === "target"
        ? c.target === id && c.role === handleId
        : c.source.kind !== "files" && c.source.taskId === id &&
          [c.source.outputRole, "output:" + c.source.outputRole].includes(handleId)
    )
  return (
    <section
      className="subflow-node"
      aria-label={name}
      data-flow={flow?.run}
      data-selected={flow ? selected : undefined}
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
        <strong title={name}>{name}</strong>
        {flow && <span className="flow-statement" title={flow.statement}>{flow.statement}</span>}
        {meta && <span className="flow-progress">{meta}</span>}
        <Button
          className="nodrag nopan"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 편집`}
          // A container's settings are in the inspector.
          onClick={() => (flow ? choose(id) : editGroup(data.group.id))}
        >
          <Pencil />
        </Button>
        <span className="group-task-count" aria-label={`${data.count}개 작업`}>
          <Terminal aria-hidden="true" />
          <span>{data.count}</span>
        </span>
        <Button
          className="nodrag nopan"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 접기`}
          title="접기"
          onClick={() => setGroupCollapsed(data.group.id, true)}
        >
          <ChevronsDownUp />
        </Button>
        <Button
          className="nodrag nopan subflow-run-button"
          variant="default"
          size="icon"
          aria-label={`${name} 실행`}
          title={`${name} 실행`}
          disabled={groupRunDisabled || !data.count || !runGroup}
          onClick={() => runGroup?.(data.group.id)}
        >
          <Play />
        </Button>
      </header>
      {flow?.lane !== undefined && (
        <div className="flow-lane" style={{ top: flow.lane }} aria-hidden="true" />
      )}
      {flow?.ports.map((port) => (
        <Handle
          key={port.handleId}
          type={port.type}
          position={port.side === "left" ? Position.Left : Position.Right}
          id={port.handleId}
          isConnectable={isConnectable}
          className={`workflow-input-handle flow-port${port.value ? " workflow-value-handle" : ""}`}
          data-connected={connected(port.handleId, port.type)}
          style={
            port.side === "left"
              ? { left: port.x, top: port.y }
              : { left: "auto", right: data.group.width - port.x, top: port.y }
          }
          aria-label={`${name} ${port.label ?? "결과"} ${port.type === "target" ? "입력" : "출력"} 연결`}
        />
      ))}
      {flow?.ports
        .filter((port) => port.label && port.x > 0 && port.x < data.group.width)
        .map((port) => (
          <span
            key={port.handleId}
            className="flow-port-label"
            data-side={port.side}
            style={
              port.side === "right"
                ? { left: port.x + 12, top: port.y }
                : { right: data.group.width - port.x + 12, top: port.y }
            }
          >
            {port.label}
          </span>
        ))}
      <NodeResizeControl
        onResizeStart={beginEdit}
        onResizeEnd={endEdit}
        minWidth={data.minWidth}
        minHeight={data.minHeight}
        aria-label={`${name} 크기 조절`}
        className="subflow-resize"
      >
        <Maximize2 aria-hidden="true" />
      </NodeResizeControl>
    </section>
  )
})
