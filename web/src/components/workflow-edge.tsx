import { BaseEdge, getBezierPath, getSmoothStepPath, type EdgeProps } from "@xyflow/react"
import { roundedRoute, type Point } from "@/lib/edge-routing"

export function WorkflowEdge(props: EdgeProps) {
  const points = props.data?.points as Point[] | undefined
  const start = points?.[0], end = points?.at(-1)
  // A manual move invalidates the saved route; never draw a detached edge.
  const aligned = points && points.length >= 2 && start && end &&
    Math.abs(start.x - props.sourceX) <= 2 && Math.abs(start.y - props.sourceY) <= 2 &&
    Math.abs(end.x - props.targetX) <= 2 && Math.abs(end.y - props.targetY) <= 2
  // React Flow includes the node border in measured handles (up to 1px).
  const path = props.type !== "smoothstep" ? getBezierPath(props)[0] : aligned ? roundedRoute(points.map(p => ({
    x: p.x === start.x ? props.sourceX : p.x === end.x ? props.targetX : p.x,
    y: p.y === start.y ? props.sourceY : p.y === end.y ? props.targetY : p.y,
  }))) : getSmoothStepPath(props)[0]
  return <BaseEdge id={props.id} path={path}
    style={props.style} markerStart={props.markerStart} markerEnd={props.markerEnd} interactionWidth={props.interactionWidth} />
}
