import { memo, useContext, type CSSProperties } from "react"
import { NodeResizeControl, type NodeProps } from "@xyflow/react"
import { Play, GripVertical, Pencil, Maximize2, Terminal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { subflowColor } from "@/lib/subflow"
import { type SubflowNode } from "@/lib/workflow-flow"

import { WorkflowContext } from "./context"
export const GroupNode = memo(function GroupNode({
  data,
}: NodeProps<SubflowNode>) {
  const {
    editGroup,
    runGroup,
    groupRunDisabled,
    dragPreview,
    beginEdit,
    endEdit,
  } = useContext(WorkflowContext)!
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
          <Terminal aria-hidden="true" />
          <span>{data.count}</span>
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
        onResizeStart={beginEdit}
        onResizeEnd={endEdit}
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
