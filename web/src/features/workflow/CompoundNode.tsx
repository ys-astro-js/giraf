import { memo, useContext, useEffect, type CSSProperties } from "react"
import { Position, useUpdateNodeInternals, type NodeProps } from "@xyflow/react"
import { ChevronsUpDown, GripVertical, Pencil, Play, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { compoundStatus } from "@/lib/compound"
import { flowProgress } from "@/lib/containers"
import { subflowColor } from "@/lib/subflow"
import { stateLabel } from "@/lib/task-map"
import { type CompoundNode as CompoundFlowNode } from "@/lib/workflow-flow"

import { WorkflowContext } from "./context"
import { Handle } from "./Handle"
import { StatusIcon } from "./StatusIcon"

export const CompoundNode = memo(function CompoundNode({
  id,
  data,
  selected,
  dragging,
  isConnectable,
}: NodeProps<CompoundFlowNode>) {
  const { map, currentIssues, runGroup, groupRunDisabled, setGroupCollapsed, editGroup, choose, flowProgress: progress } =
    useContext(WorkflowContext)!
  const { group, members, inputs, outputs, height, flow } = data
  // A container keeps its statement as the heading, collapsed or not.
  const name = flow?.statement ?? group.name
  const meta = flowProgress(flow?.run, progress?.id === id ? progress : undefined)
  const status = compoundStatus(map, members, currentIssues, flow ? id : undefined)
  const statusLabel = status.severity
    ? `${status.severity === "error" ? "오류" : "경고"}: ${status.issues.map((issue) => issue.message).join("; ")}`
    : status.state
      ? stateLabel(status.state)
      : "실행 전"
  const updateNodeInternals = useUpdateNodeInternals()
  const handlesKey = [...inputs, ...outputs].map((row) => row.handleId).join("|")
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handlesKey, updateNodeInternals])
  const expand = () => setGroupCollapsed(group.id, false)
  return (
    <article
      className="workflow-node compound-node"
      style={
        {
          width: data.width,
          minHeight: height,
          "--group-color": subflowColor(group.color),
        } as CSSProperties
      }
      aria-label={`${name} ${flow ? "컨테이너" : "그룹"} 노드`}
      data-selected={selected}
      data-dragging={dragging}
      data-flow={flow?.run}
      data-running={status.state === "running"}
      data-diagnostic={status.severity}
    >
      {/* The expanded group's heading, with expand in place of collapse. */}
      <header
        className="subflow-heading"
        onDoubleClick={(e) => {
          e.stopPropagation()
          expand()
        }}
      >
        <GripVertical aria-hidden="true" />
        <strong className={flow ? "flow-statement" : undefined} title={name}>{name}</strong>
        <span
          className="node-state"
          data-severity={status.severity}
          data-running={status.state === "running"}
          role="img"
          aria-label={statusLabel}
          title={statusLabel}
        >
          <StatusIcon severity={status.severity} state={status.state} />
        </span>
        {meta && <span className="flow-progress">{meta}</span>}
        <Button
          className="nodrag nopan"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 편집`}
          onClick={(e) => {
            e.stopPropagation()
            if (flow) choose(id)
            else editGroup(group.id)
          }}
        >
          <Pencil />
        </Button>
        <span
          className="group-task-count"
          aria-label={`${members.length}개 작업`}
        >
          <Terminal aria-hidden="true" />
          <span>{members.length}</span>
        </span>
        <Button
          className="nodrag nopan"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 펼치기`}
          title="펼치기"
          onClick={(e) => {
            e.stopPropagation()
            expand()
          }}
        >
          <ChevronsUpDown />
        </Button>
        <Button
          className="nodrag nopan subflow-run-button"
          variant="default"
          size="icon"
          aria-label={`${name} 실행`}
          title={`${name} 실행`}
          disabled={groupRunDisabled || !members.length || !runGroup}
          onClick={(e) => {
            e.stopPropagation()
            runGroup?.(group.id)
          }}
        >
          <Play />
        </Button>
      </header>
      <div className="node-section node-inputs">
        {inputs.length ? (
          inputs.map((row) => (
            <div className="node-input-row" key={row.handleId}>
              <Handle
                type="target"
                position={Position.Left}
                id={row.handleId}
                isConnectable={isConnectable}
                className={`workflow-input-handle${row.value ? " workflow-value-handle" : ""}`}
                data-connected={map.connections.some((c) => c.target === row.member && c.role === row.port)}
                aria-label={`${name} ${row.label} 입력 연결`}
              />
              <div className="node-input">
                <span className="node-input-label">{row.label}</span>
                <span className="node-input-source" title={row.summary}>
                  {row.summary}
                </span>
              </div>
            </div>
          ))
        ) : (
          <p className="node-no-input">입력 없음</p>
        )}
      </div>
      {outputs.length > 0 && (
        <div className="node-section node-outputs">
          {outputs.map((row) => (
            <div className="node-output-row" key={row.handleId}>
              <span className="node-output-name">{row.label}</span>
              <Handle
                type="source"
                position={Position.Right}
                id={row.handleId}
                isConnectable={isConnectable}
                className="workflow-output-handle"
                data-named={true}
                data-connected={true}
                aria-label={`${name} ${row.label} 출력 연결`}
              />
            </div>
          ))}
        </div>
      )}
    </article>
  )
})
