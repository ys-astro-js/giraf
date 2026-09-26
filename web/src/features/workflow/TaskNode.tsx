import { customOutput, customPortHandle } from "@/lib/output-ports"
import {
  groupEqual,
  groupLabel,
  matchesGroup,
  compactPortLabel,
} from "@/lib/calibration-ports"
import { ccdTasks, calibrationLabels } from "@/lib/calibration"
import { taskDisplayName } from "@/lib/workbench"
import { ArrowRight } from "lucide-react"
import { memo, useContext, useEffect, useRef } from "react"
import {
  Position,
  useConnection,
  useStore,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react"
import {
  LoaderCircle,
  Check,
  GripVertical,
  Copy,
  File,
  CircleX,
  TriangleAlert,
  CircleDashed,
  Clock3,
  Ban,
  CircleHelp,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { stateLabel } from "@/lib/task-map"
import { assigned } from "@/lib/task-map/inputs"
import { nodeOutput, roleActive } from "@/lib/node-interaction"
import { outputHandle, type TaskFlowNode } from "@/lib/workflow-flow"

import { WorkflowContext } from "./context"
import { Handle } from "./Handle"
export const TaskNode = memo(function TaskNode({
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
  const nodeIssues = currentIssues.filter((issue) => issue.nodeId === id)
  const nodeIssue =
    nodeIssues.find((issue) => issue.severity === "error") || nodeIssues[0]
  const spec = catalog.tasks.find((s) => s.name === task.task)
  const sourceConnections = map.connections.filter(
    (connection) =>
      connection.source.kind !== "files" && connection.source.taskId === id
  )
  const isOutputConnected = (handle: string) =>
    sourceConnections.some(
      (connection) => outputHandle(connection.source, spec) === handle
    )
  const run = map.runs.filter((r) => r.instanceId === id).at(-1)
  const nodeStatus = nodeIssue
    ? `${nodeIssue.severity === "error" ? "오류" : "경고"}: ${nodeIssues.map((issue) => issue.message).join("; ")}`
    : run
      ? stateLabel(run.state)
      : "실행 전"
  const output = nodeOutput(map, id, geometry.primaryOutputRole)
  const primaryName =
    task.outputPorts?.find((p) => p.id === "$default")?.name.trim() || ""
  const clickStart = useStore((state) => state.connectionClickStartHandle)
  const connecting = useConnection((state) => state.inProgress)
  const connectionTarget = useConnection((connection) =>
    connection.inProgress && connection.isValid && connection.toNode?.id === id
      ? (connection.toHandle?.id ?? null)
      : null
  )
  const inputHandles = useRef(new Map<string, HTMLDivElement>())
  const updateNodeInternals = useUpdateNodeInternals()
  const handlesKey = [
    primaryName,
    String(geometry.primaryOutputRole),
    String(geometry.width),
    ...geometry.roles.map((s) => s.name),
    ...geometry.outputs.map((s) => s.handleId + ":" + s.name),
  ].join("|")
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handlesKey, updateNodeInternals])
  return (
    <article
      className="workflow-node"
      style={{ minHeight: geometry.height }}
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
              {task.label === task.task
                ? taskDisplayName(task.task)
                : task.label || taskDisplayName(task.task)}
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
            const allRows = [...rows, ...map.runs.flatMap((r) => r.products)]
            const a = slot.group
              ? {
                  ...assignedRole,
                  ids: assignedRole.ids.filter((id) => {
                    const frame = allRows.find((r) => r.id === id)
                    return (
                      frame &&
                      (frame.asset === "image-list" ||
                        matchesGroup(frame, slot.group!))
                    )
                  }),
                }
              : assignedRole
            const links = map.connections.filter(
              (c) =>
                c.target === id &&
                c.role === slot.role &&
                (c.source.kind !== "files" || c.source.ids.length > 0) &&
                (!slot.group ||
                  !c.targetGroup ||
                  groupEqual(slot.group, c.targetGroup))
            )
            const summary =
              (task.draft.textInputs?.[slot.name]?.trim()
                ? "직접 입력 " +
                  task.draft.textInputs[slot.name].trim().split("\n").length +
                  "행"
                : "") ||
              (task.draft.cursorCommands?.[slot.role]?.trim()
                ? "커서 명령 " +
                  task.draft.cursorCommands[slot.role].trim().split("\n")
                    .length +
                  "행"
                : "") ||
              task.expressions[slot.role] ||
              (links.length
                ? links
                    .map((c) =>
                      c.source.kind === "files"
                        ? `파일 ${
                            slot.group
                              ? c.source.ids.filter((id) => {
                                  const frame = allRows.find((r) => r.id === id)
                                  return (
                                    frame && matchesGroup(frame, slot.group!)
                                  )
                                }).length
                              : c.source.ids.length
                          }개`
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
                  aria-label={`${task.label} ${slot.role} ${slot.group ? groupLabel(slot.group) + " " : ""}입력 연결`}
                >
                  {slot.group && <span>{compactPortLabel(slot.group)}</span>}
                </Handle>
                <Tooltip disabled={connecting}>
                  <TooltipTrigger
                    render={<button />}
                    className="node-input nodrag nopan"
                    data-input-role={slot.name}
                    data-connection-choice={!!pickable}
                    aria-label={`${task.label} ${slot.role} ${slot.group ? groupLabel(slot.group) : ""}${pickable ? "에 연결" : " 설정"}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (clickStart) {
                        if (enabled && isConnectable)
                          inputHandles.current.get(slot.name)?.click()
                      } else if (pickable && dropChoice)
                        finishDrop(id, dropChoice.source, slot.name)
                      else {
                        choose(id)
                        onInput?.(id, slot.name)
                      }
                    }}
                  >
                    <span className="node-input-label">
                      {!slot.group &&
                        (ccdTasks.has(task.task)
                          ? calibrationLabels[slot.role] || slot.role
                          : slot.role)}
                      {!enabled && <span> 비활성</span>}
                    </span>
                    <span className="node-input-source" title={summary}>
                      {links.some((c) => c.source.kind === "pending")
                        ? `${summary} 출력 대기`
                        : summary}
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
        <span
          className="node-state"
          data-severity={nodeIssue?.severity}
          data-failed={!nodeIssue && run?.state === "failed"}
          role="img"
          aria-label={nodeStatus}
          title={nodeStatus}
        >
          {nodeIssue?.severity === "error" ? (
            <CircleX aria-hidden="true" />
          ) : nodeIssue ? (
            <TriangleAlert aria-hidden="true" />
          ) : run?.state === "running" || run?.state === "queued" ? (
            <LoaderCircle className="node-running-icon" aria-hidden="true" />
          ) : run?.state === "completed" ? (
            <Check aria-hidden="true" />
          ) : run?.state === "waiting" ? (
            <Clock3 aria-hidden="true" />
          ) : run?.state === "failed" ? (
            <CircleX aria-hidden="true" />
          ) : run?.state === "cancelled" ? (
            <Ban aria-hidden="true" />
          ) : run ? (
            <CircleHelp aria-hidden="true" />
          ) : (
            <CircleDashed aria-hidden="true" />
          )}
        </span>

        {output.kind === "result" && (
          <span
            className="node-output-summary"
            aria-label={`${output.ids.length}개 항목`}
          >
            <File aria-hidden="true" />
            <span>{output.ids.length}</span>
          </span>
        )}
        <Handle
          type="source"
          position={Position.Right}
          id="output"
          role="button"
          tabIndex={isConnectable ? 0 : -1}
          aria-label={`${task.label} ${primaryName ? primaryName + " " : ""}출력 연결`}
          title={primaryName || "기본 출력 연결"}
          isConnectable={isConnectable}
          className={`workflow-output-handle${primaryName ? " workflow-named-port" : ""}`}
          style={{
            top: geometry.outputY,
            left: geometry.outputX,
            bottom: "auto",
            transform: "translate(-50%, -50%)",
          }}
          data-connected={isOutputConnected("output")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault()
              e.stopPropagation()
              e.currentTarget.click()
            }
          }}
        >
          {primaryName ? (
            <span>{primaryName}</span>
          ) : (
            <ArrowRight aria-hidden="true" />
          )}
        </Handle>
      </div>

      {geometry.outputs.map((slot) => {
        const custom = task.outputPorts?.find(
          (p) => customPortHandle(p.id) === slot.handleId
        )
        const result = custom
          ? customOutput(map, id, custom)
          : nodeOutput(map, id, slot.outputRole, slot.group)
        const name = slot.name.trim()
        return (
          <Handle
            key={slot.handleId}
            type="source"
            position={Position.Right}
            id={slot.handleId}
            style={{
              top: slot.y,
              left: slot.x,
              bottom: "auto",
              transform: "translate(-50%, -50%)",
            }}
            isConnectable={isConnectable}
            className={`workflow-output-handle workflow-right-port${name ? " workflow-named-port" : ""}`}
            data-connected={isOutputConnected(slot.handleId)}
            role="button"
            tabIndex={isConnectable ? 0 : -1}
            aria-label={`${task.label} ${name || "이름 없는 포트"} 출력 연결`}
            title={`${name || "출력"} — ${result.kind === "result" ? result.ids.length + "개" : "출력 대기"}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault()
                e.stopPropagation()
                e.currentTarget.click()
              }
            }}
          >
            {name ? <span>{name}</span> : <ArrowRight aria-hidden="true" />}
          </Handle>
        )
      })}
    </article>
  )
})
// Stable nodeTypes avoid remounting nodes during edits.
