import { memo, useContext, type CSSProperties } from "react"
import { NodeResizeControl, type NodeProps } from "@xyflow/react"
import { Play, GripVertical, Pencil, Maximize2, Terminal, ChevronsDownUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { subflowColor } from "@/lib/subflow"
import { groupContents } from "@/lib/group-nesting"
import { compoundStatus } from "@/lib/compound"
import { stateLabel } from "@/lib/task-map"
import { type SubflowNode } from "@/lib/workflow-flow"

import { WorkflowContext } from "./context"
import { StatusIcon } from "./StatusIcon"
export const GroupNode = memo(function GroupNode({
  data,
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
    currentIssues,
  } = useContext(WorkflowContext)!
  const name = data.group.name
  // The same status as the collapsed node: members' runs and diagnostics.
  const members = [...groupContents(map, data.group.id).tasks]
  const status = compoundStatus(map, members, currentIssues)
  const statusLabel = status.severity
    ? `${status.severity === "error" ? "오류" : "경고"}: ${status.issues.map((issue) => issue.message).join("; ")}`
    : status.state
      ? stateLabel(status.state)
      : "실행 전"
  return (
    <section
      className="subflow-node"
      aria-label={name}
      data-diagnostic={status.severity}
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
        <Button
          className="nodrag nopan"
          variant="ghost"
          size="icon-sm"
          aria-label={`${name} 편집`}
          onClick={() => editGroup(data.group.id)}
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
