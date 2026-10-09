import { BaseEdge, EdgeLabelRenderer, getBezierPath, getSmoothStepPath, useInternalNode, type EdgeProps } from "@xyflow/react"
import { roundedRoute, type Point } from "@/lib/edge-routing"
import type { EdgeCrossing, TaskFlowNode } from "@/lib/workflow-flow"
import { useContext, useMemo } from "react"
import { WorkflowContext } from "@/features/workflow/context"
import { chipPlace, pathPoints } from "@/lib/edge-crossing"
import { withMeans } from "@/lib/korean"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** About how wide a chip draws its words (11px semibold): Hangul wider than Latin, with padding and border. */
const chipWidth = (text: string) => [...text].reduce((sum, c) => sum + (/[ㄱ-힝]/.test(c) ? 11 : 7), 14)

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
  const context = useContext(WorkflowContext)
  const crossings = props.data?.bypass ? undefined : props.data?.crossings as EdgeCrossing[] | undefined
  const groups = context?.map.subflows
  // Each chip sits where the edge last enters its region's border, moved along
  // the edge past chips other edges placed there first.
  const along = useMemo(() => (crossings?.length ? pathPoints(path) : []), [crossings, path])
  const placed = context?.chipBoxes
  const chips = (crossings ?? []).flatMap((crossing) => {
    const group = groups?.find((g) => g.id === crossing.region)
    if (!group) return []
    const key = `${crossing.region}\u0000${props.id}`
    const taken = [...(placed ?? [])].filter(([k]) => k < key && k.startsWith(crossing.region + "\u0000")).map(([, box]) => box)
    const size = { width: chipWidth(crossing.text), height: 20 }
    const at = chipPlace(along, { ...group.position, width: group.width, height: group.height }, size, taken)
    if (at) placed?.set(key, { ...at, ...size })
    else placed?.delete(key)
    return at ? [{ crossing, at }] : []
  })
  return <>
    <BaseEdge id={props.id} path={path}
      style={props.style} markerStart={props.markerStart} markerEnd={props.markerEnd} interactionWidth={props.interactionWidth} />
    {label && <EdgeLabelRenderer>
      <span className="workflow-edge-label" data-end={label.end || undefined}
        style={{ transform: `translate(${label.x}px, ${label.y}px) translate(${label.end ? "-100%" : "-50%"}, -50%)`, opacity: (props.style as { opacity?: number } | undefined)?.opacity }}>
        {props.data?.value ? value : role}
      </span>
    </EdgeLabelRenderer>}
    {!!chips.length && <EdgeLabelRenderer>
      {chips.map(({ crossing, at }) => <RegionChip key={crossing.region} connectionId={props.id} crossing={crossing} at={at}
        opacity={(props.style as { opacity?: number } | undefined)?.opacity} />)}
    </EdgeLabelRenderer>}
  </>
}

/**
 * How a connection receives at a region's border (lib/containers): the chip
 * names it and opens a menu to change it. Its connection's diagnostics show
 * on it as on the node.
 */
function RegionChip({ connectionId, crossing, at, opacity }: { connectionId: string; crossing: EdgeCrossing; at: { x: number; y: number }; opacity?: number }) {
  const context = useContext(WorkflowContext)
  const connection = context?.map.connections.find((c) => c.id === connectionId)
  const from = connection && connection.source.kind !== "files" ? connection.source.taskId : undefined
  const source = context?.map.tasks.find((t) => t.id === from)
  const region = context?.map.tasks.find((t) => t.id === crossing.region)
  const issues = context?.currentIssues.filter((issue) => issue.connectionId === connectionId) ?? []
  const severity = issues.some((issue) => issue.severity === "error") ? "error" : issues.length ? "warning" : undefined
  const choose = context?.chooseReceive
  const name = source?.label ?? ""
  return <DropdownMenu>
    <DropdownMenuTrigger
      render={<button type="button" />}
      className="region-chip nodrag nopan"
      data-severity={severity}
      title={issues.map((issue) => issue.message).join("\n") || undefined}
      aria-label={`${name} ${region?.label ?? ""} ${crossing.text}${issues.map((issue) => `, ${issue.severity === "error" ? "오류" : "경고"}: ${issue.message}`).join("")}`}
      disabled={!choose}
      style={{ transform: `translate(${at.x}px, ${at.y}px) translate(-50%, -50%)`, opacity }}
    >
      {crossing.text}
    </DropdownMenuTrigger>
    <DropdownMenuContent aria-label={`${name} 받는 방법`}>
      <DropdownMenuRadioGroup
        value={crossing.mode === "match" ? "" : crossing.mode}
        onValueChange={(mode: string) => choose?.(connectionId, crossing.region, mode === "split" ? "split" : "all")}
      >
        {/* Values have no files to divide. */}
        {!crossing.value && <DropdownMenuRadioItem value="split" closeOnClick>나눠서</DropdownMenuRadioItem>}
        <DropdownMenuRadioItem value="all" closeOnClick>모두에</DropdownMenuRadioItem>
      </DropdownMenuRadioGroup>
      {crossing.labels.map((key) => (
        <DropdownMenuCheckboxItem
          key={key}
          checked={crossing.mode === "match" && crossing.keys.includes(key)}
          onCheckedChange={() => choose?.(connectionId, crossing.region, { key })}
        >
          {withMeans(key)} 짝
        </DropdownMenuCheckboxItem>
      ))}
    </DropdownMenuContent>
  </DropdownMenu>
}
