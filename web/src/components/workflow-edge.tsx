import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, useInternalNode, type EdgeProps } from "@xyflow/react"
import { roundedRoute, type Point } from "@/lib/edge-routing"
import type { TaskFlowNode } from "@/lib/workflow-flow"
import { useContext } from "react"
import { WorkflowContext } from "@/features/workflow/context"

/** A point late on React Flow's bezier, near the target, so labels of edges sharing a port separate. */
function labelPoint(sx: number, sy: number, tx: number, ty: number, t = 0.75) {
  const d = tx - sx
  const offset = d >= 0 ? d / 2 : 0.25 * 25 * Math.sqrt(-d)
  const c1 = { x: sx + offset, y: sy }, c2 = { x: tx - offset, y: ty }, u = 1 - t
  const at = (a: number, b: number, c: number, e: number) => u * u * u * a + 3 * u * u * t * b + 3 * u * t * t * c + t * t * t * e
  return { x: at(sx, c1.x, c2.x, tx), y: at(sy, c1.y, c2.y, ty) }
}

export function WorkflowEdge(props: EdgeProps) {
  const points = props.data?.points as Point[] | undefined
  const role = props.data?.role as string | undefined
  const start = points?.[0], end = points?.at(-1)
  // A manual move invalidates the saved route; never draw a detached edge.
  const aligned = points && points.length >= 2 && start && end &&
    Math.abs(start.x - props.sourceX) <= 2 && Math.abs(start.y - props.sourceY) <= 2 &&
    Math.abs(end.x - props.targetX) <= 2 && Math.abs(end.y - props.targetY) <= 2
  // React Flow includes the node border in measured handles (up to 1px).
  const [bezier, bezierX, bezierY] = getBezierPath(props)
  const [step, stepX, stepY] = getSmoothStepPath(props)
  const path = props.type !== "smoothstep" ? bezier : aligned ? roundedRoute(points.map(p => ({
    x: p.x === start.x ? props.sourceX : p.x === end.x ? props.targetX : p.x,
    y: p.y === start.y ? props.sourceY : p.y === end.y ? props.targetY : p.y,
  }))) : step
  // A value connection shows its current value at its middle.
  // A bypass edge (lib/helper-nodes) shows the value of the connection that feeds the row.
  const value = useContext(WorkflowContext)?.valueLabel((props.data?.connection as string | undefined) ?? props.id) ?? ""
  const target = useInternalNode<TaskFlowNode>(props.target)
  const collapsed = target?.type === "task" && target.data.geometry.collapsed
  const label = props.data?.value
    ? value ? { x: props.type === "smoothstep" ? stepX : bezierX, y: props.type === "smoothstep" ? stepY : bezierY, end: false } : null
    : collapsed && role
    ? props.type === "smoothstep"
      ? { x: props.targetX - 16, y: props.targetY, end: true }
      : { ...labelPoint(props.sourceX, props.sourceY, props.targetX, props.targetY), end: false }
    : null
  return <>
    <BaseEdge id={props.id} path={path}
      style={props.style} markerStart={props.markerStart} markerEnd={props.markerEnd} interactionWidth={props.interactionWidth} />
    {label && <EdgeLabelRenderer>
      <span className="workflow-edge-label" data-end={label.end || undefined}
        style={{ transform: `translate(${label.x}px, ${label.y}px) translate(${label.end ? "-100%" : "-50%"}, -50%)`, opacity: (props.style as { opacity?: number } | undefined)?.opacity }}>
        {props.data?.value ? value : role}
      </span>
    </EdgeLabelRenderer>}
  </>
}
