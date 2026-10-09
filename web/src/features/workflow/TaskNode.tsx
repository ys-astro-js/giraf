import { customOutput, customPortHandle } from "@/lib/output-ports"
import { groupLabel } from "@/lib/calibration-ports"
import { ccdTasks, calibrationLabels } from "@/lib/calibration"
import { acceptsSource, isGirafNode, taskDisplayName } from "@/lib/workbench"
import { Fragment, memo, useContext, useEffect, useRef, useState } from "react"
import {
  Position,
  useConnection,
  useStore,
  useUpdateNodeInternals,
  type NodeProps,
} from "@xyflow/react"
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  Copy,
  File,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { NodeIcon } from "@/components/node-icon"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { stateLabel } from "@/lib/task-map"
import { assigned } from "@/lib/task-map/inputs"
import {
  COLLAPSED_WIDTH,
  NODE_WIDTH,
  nodeOutput,
  nodePreviewIds,
  roleActive,
} from "@/lib/node-interaction"
import { outputHandle, type TaskFlowNode } from "@/lib/workflow-flow"
import { isSourceNode } from "@/lib/file-nodes"
import {
  formatScalar,
  formatValue,
  parameterEntries,
  psetSource,
  storedValue,
  PARAM_HANDLE,
  PSET_INPUT,
  PSET_OUTPUT,
  VALUE_HANDLE,
} from "@/lib/values"
import type { Source } from "@/lib/task-map"
import { valueDescription } from "@/lib/value-modes"

import { innerPortLabel, isContainerId } from "@/lib/containers"
import { WorkflowContext } from "./context"
import { Handle } from "./Handle"
import { StatusIcon } from "./StatusIcon"

const count = (source: Source) =>
  source.kind === "result" ? `${source.ids.length}개` : ""
const valueLabel = (value: string) => value || "값 없음"
/** Filter letters carry their color; any other header value is neutral. */
function ValueChip({ value }: { value: string }) {
  return (
    <span className="partition-chip" data-filter={value || undefined}>
      {valueLabel(value)}
    </span>
  )
}

const activate = (e: React.KeyboardEvent<HTMLElement>) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.click()
  }
}

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
    open,
    setCollapsed,
    setPortOpen,
    currentIssues,
    values,
    onParameter,
    hiddenNodes,
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
      (connection) => outputHandle(connection.source, spec, task) === handle
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
  const title =
    task.label === task.task
      ? taskDisplayName(task.task)
      : task.label || taskDisplayName(task.task)
  const description =
    task.description ?? valueDescription(map, catalog, task) ?? spec?.description ?? spec?.title
  // The heading's tooltip names the task, and the label too when it renames the task.
  const titleHint =
    title === taskDisplayName(task.task) ? task.task : `${title}\n${task.task}`
  // GIRAF's own nodes show what they are; IRAF tasks are known by name.
  const icon = isGirafNode(spec) && <NodeIcon icon={spec?.icon} run={spec?.run} />

  const clickStart = useStore((state) => state.connectionClickStartHandle)
  const connecting = useConnection((state) => state.inProgress)
  const connectionOrigin = useConnection((state) => state.fromNode?.id)
  const fromNode = useConnection((state) => (state.inProgress ? state.fromHandle?.nodeId : undefined))
  const fromId = useConnection((state) => (state.inProgress ? state.fromHandle?.id : undefined))
  const connectionFrom = fromNode ? { nodeId: fromNode, id: fromId } : null
  const connectionTarget = useConnection((connection) =>
    connection.inProgress && connection.isValid && connection.toNode?.id === id
      ? (connection.toHandle?.id ?? null)
      : null
  )
  // Stored collapse or a zoomed-out canvas; flowNodes decides both with the handles.
  const folded = geometry.collapsed
  const linking =
    (connecting && connectionOrigin !== id) ||
    (!!clickStart && clickStart.nodeId !== id)
  const article = useRef<HTMLElement>(null)
  // A collapsed node opens while a connection hovers it, so a role can be chosen.
  const [peek, setPeek] = useState(false)
  useEffect(() => {
    if (!linking || !folded) return
    let frame = 0
    const move = (e: PointerEvent) => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const r = article.current?.getBoundingClientRect()
        setPeek(
          !!r &&
            e.clientX >= r.left - 16 &&
            e.clientX <= r.right + 16 &&
            e.clientY >= r.top - 16 &&
            e.clientY <= r.bottom + 16
        )
      })
    }
    document.addEventListener("pointermove", move)
    return () => {
      document.removeEventListener("pointermove", move)
      cancelAnimationFrame(frame)
      setPeek(false)
    }
  }, [linking, folded])
  const collapsed = folded && !(peek && linking)
  const linkFrom = connectionFrom ?? (clickStart ? { nodeId: clickStart.nodeId, id: clickStart.id } : null)
  // A pset node being connected offers this task's matching pset as a row.
  const offeredPset = linkFrom?.id === PSET_OUTPUT && linkFrom.nodeId !== id
    ? map.tasks.find((t) => t.id === linkFrom.nodeId)?.draft.pset
    : undefined
  const entries = parameterEntries(catalog, task)
  const params = [
    ...geometry.params,
    ...(spec?.parameterSets ?? [])
      .filter((set) => offeredPset && set.task === offeredPset.task &&
        !geometry.params.some((row) => row.handleId === PSET_INPUT + set.name))
      .map((set) => ({ key: set.name, handleId: PSET_INPUT + set.name, pset: true, y: 0 })),
  ]

  const inputHandles = useRef(new Map<string, HTMLDivElement>())
  const updateNodeInternals = useUpdateNodeInternals()
  const handlesKey = [
    collapsed,
    primaryName,
    String(geometry.primaryOutputRole),
    String(geometry.preview),
    ...geometry.roles.map((s) => s.name),
    ...geometry.outputs.map((s) => s.handleId + ":" + s.name),
    ...geometry.members.map((s) => s.handleId + ":" + s.y),
    ...params.map((s) => s.handleId),
    ...geometry.values.map((s) => s.handleId),
  ].join("|")
  useEffect(() => {
    updateNodeInternals(id)
  }, [id, handlesKey, updateNodeInternals])

  const status = (
    <span
      className="node-state"
      data-severity={nodeIssue?.severity}
      data-failed={!nodeIssue && run?.state === "failed"}
      data-running={run?.state === "running" || run?.state === "queued"}
      role="img"
      aria-label={nodeStatus}
      title={nodeStatus}
    >
      <StatusIcon severity={nodeIssue?.severity} state={run?.state} />
    </span>
  )

  const inputHandle = (slot: (typeof geometry.roles)[number], stacked = false) => {
    if (!acceptsSource(slot, "node")) return null
    const links = map.connections.filter(
      (c) =>
        c.target === id &&
        c.role === slot.role &&
        (c.source.kind !== "files" || c.source.ids.length > 0)
    )
    const enabled = roleActive(task, slot.role, catalog)
    return (
      <Handle
        key={slot.name}
        ref={(element) => {
          if (element) inputHandles.current.set(slot.name, element)
          else inputHandles.current.delete(slot.name)
        }}
        data-connected={links.length > 0}
        data-stacked={stacked || undefined}
        role="button"
        tabIndex={enabled && isConnectable && !stacked ? 0 : -1}
        onKeyDown={activate}
        type="target"
        position={Position.Left}
        id={slot.name}
        isConnectable={isConnectable && enabled}
        className="workflow-input-handle"
        aria-label={`${task.label} ${slot.role} 입력 연결`}
      />
    )
  }

  const paramLink = (handleId: string) =>
    map.connections.find((c) => c.target === id && c.role === handleId)
  const paramHandle = (row: (typeof params)[number], stacked = false) => {
    const link = paramLink(row.handleId)
    const entry = entries.get(row.key)
    return (
      <Handle
        key={row.handleId}
        type="target"
        position={Position.Left}
        id={row.handleId}
        role="button"
        tabIndex={isConnectable && !stacked && entry?.param.connectable !== false ? 0 : -1}
        onKeyDown={activate}
        isConnectable={isConnectable && entry?.param.connectable !== false}
        className={`workflow-input-handle ${row.pset ? "workflow-pset-handle" : "workflow-value-handle"}`}
        data-connected={!!link}
        data-stacked={stacked || undefined}
        // Every pinned parameter shows that it can take a value, like an input row.
        data-hidden={entry?.param.connectable === false || undefined}
        aria-label={`${task.label} ${row.key} ${row.pset ? "pset" : "값"} 연결`}
      />
    )
  }
  const taskLabel = (taskId?: string) => map.tasks.find((t) => t.id === taskId)?.label
  /** The pinned row's value, the node it comes from when it is connected, and that node's id. */
  const paramText = (row: (typeof params)[number]): { text: string; from?: string; fromId?: string } => {
    const link = paramLink(row.handleId)
    if (row.pset)
      return link && link.source.kind !== "files"
        ? { text: taskLabel(link.source.taskId) ?? "", fromId: link.source.taskId }
        : { text: "" }
    if (link && link.source.kind !== "files") {
      const from = taskLabel(link.source.taskId), fromId = link.source.taskId
      const taken = values?.parameters[link.id]
      if (taken && taken.error === undefined) return { text: formatScalar(taken.value), from, fromId }
      return { text: formatValue(values?.outputs[`${link.source.taskId}:${link.source.outputRole?.slice(VALUE_HANDLE.length)}`]), from, fromId }
    }
    const entry = entries.get(row.key)
    if (!entry) return { text: "" }
    // A pset fed by a pset node runs with that node's values.
    const shared = entry.owner ? psetSource(map, id, entry.owner) : undefined
    if (!shared?.draft.pset) return { text: storedValue(task, entry) }
    const held = `${shared.draft.pset.name}.${entry.param.name}`
    const sharedLink = map.connections.find((c) => c.target === shared.id && c.role === PARAM_HANDLE + held)
    if (sharedLink && sharedLink.source.kind !== "files") {
      const from = taskLabel(sharedLink.source.taskId), fromId = shared.id
      const taken = values?.parameters[`${sharedLink.id}:${id}`]
      if (taken && taken.error === undefined) return { text: formatScalar(taken.value), from, fromId }
      return { text: formatValue(values?.outputs[`${sharedLink.source.taskId}:${sharedLink.source.outputRole?.slice(VALUE_HANDLE.length)}`]), from, fromId }
    }
    return { text: storedValue(shared, { ...entry, owner: shared.draft.pset.name }), from: shared.label, fromId: shared.id }
  }
  const valueHandle = (handleId: string, name: string, stacked = false) => (
    <Handle
      key={handleId}
      type="source"
      position={Position.Right}
      id={handleId}
      role="button"
      tabIndex={isConnectable && !stacked ? 0 : -1}
      isConnectable={isConnectable}
      className={`workflow-output-handle ${handleId === PSET_OUTPUT ? "workflow-pset-handle" : "workflow-value-handle"}`}
      data-connected={isOutputConnected(handleId)}
      data-stacked={stacked || undefined}
      aria-label={`${task.label} ${name} 출력 연결`}
      onKeyDown={activate}
    />
  )

  const outputSlots = geometry.outputs.map((slot) => {
    const custom = task.outputPorts?.find(
      (p) => customPortHandle(p.id) === slot.handleId
    )
    const result = custom
      ? customOutput(map, id, custom)
      : nodeOutput(map, id, slot.outputRole, slot.group)
    return { slot, result, name: slot.name.trim() }
  })

  const outputHandleElement = (
    handleId: string,
    name: string,
    result: Source,
    stacked = false
  ) => (
    <Handle
      key={handleId}
      type="source"
      position={Position.Right}
      id={handleId}
      role="button"
      tabIndex={isConnectable && !stacked ? 0 : -1}
      isConnectable={isConnectable}
      className="workflow-output-handle"
      data-named={!!name || undefined}
      data-stacked={stacked || undefined}
      data-connected={isOutputConnected(handleId)}
      aria-label={`${task.label} ${name ? name + " " : ""}출력 연결`}
      title={`${name || "결과"} ${result.kind === "result" ? result.ids.length + "개" : "출력 대기"}`}
      onKeyDown={activate}
    >
      {!name && <ArrowRight aria-hidden="true" />}
    </Handle>
  )

  const portFor = (handleId: string) =>
    task.outputPorts?.find((p) => customPortHandle(p.id) === handleId)
  const memberHandleElement = (
    member: (typeof geometry.members)[number],
    stacked = false
  ) => {
    const port = portFor(member.base)
    const result = port ? customOutput(map, id, port, undefined, member.value) : output
    return (
      <Handle
        key={member.handleId}
        type="source"
        position={Position.Right}
        id={member.handleId}
        role="button"
        tabIndex={isConnectable && !stacked ? 0 : -1}
        isConnectable={isConnectable}
        className="workflow-output-handle workflow-member-handle"
        data-filter={member.value || undefined}
        data-stacked={stacked || undefined}
        data-connected={isOutputConnected(member.handleId)}
        aria-label={`${task.label} ${valueLabel(member.value)} 출력 연결`}
        title={`${valueLabel(member.value)} ${result.kind === "result" ? result.ids.length + "개" : "출력 대기"}`}
        onKeyDown={activate}
      >
        {!stacked && <span>{valueLabel(member.value)}</span>}
      </Handle>
    )
  }
  const outputRow = (
    handleId: string,
    name: string,
    result: Source,
    fallback: string
  ) => {
    const bundle = geometry.bundles[handleId]
    const port = portFor(handleId)
    if (!bundle || !port)
      return (
        <div className="node-output-row" key={handleId}>
          <span className="node-output-name" data-unnamed={!name} data-full-text={name || fallback}>
            {name || fallback}
          </span>
          <span className="node-output-count">{count(result)}</span>
          {outputHandleElement(handleId, name, result)}
        </div>
      )
    const label = name || fallback
    const members = geometry.members.filter((m) => m.base === handleId)
    return (
      <Fragment key={handleId}>
        <div className="node-output-row" data-bundle="true">
          <button
            className="node-bundle-toggle nodrag nopan"
            aria-label={`${label} ${bundle.open ? "접기" : "펼치기"}`}
            aria-expanded={bundle.open}
            onClick={(e) => {
              e.stopPropagation()
              setPortOpen(id, port.id, !bundle.open)
            }}
          >
            {bundle.open ? <ChevronDown /> : <ChevronRight />}
          </button>
          <span className="node-output-name" data-unnamed={!name} data-full-text={label}>
            {label}
          </span>
          <span className="node-output-keyword">{bundle.keyword}</span>
          <span className="node-output-chips" data-full-text={bundle.values.map(valueLabel).join(" ")}>
            {bundle.values.map((value) => (
              <ValueChip key={value} value={value} />
            ))}
          </span>
          <Handle
            type="source"
            position={Position.Right}
            id={handleId}
            role="button"
            tabIndex={isConnectable ? 0 : -1}
            isConnectable={isConnectable}
            className="workflow-output-handle workflow-bundle-handle"
            data-connected={isOutputConnected(handleId)}
            aria-label={`${task.label} ${label} 묶음 출력 연결`}
            title={`${label} ${bundle.keyword} ${bundle.values.length}개 묶음`}
            onKeyDown={activate}
          >
            <span>{bundle.values.length}</span>
          </Handle>
          {!bundle.open && members.map((m) => memberHandleElement(m, true))}
        </div>
        {bundle.open &&
          members.map((m) => (
            <div className="node-member-row" key={m.handleId}>
              <span className="node-output-count">
                {count(customOutput(map, id, port, undefined, m.value))}
              </span>
              {memberHandleElement(m)}
            </div>
          ))}
      </Fragment>
    )
  }

  const preview = geometry.preview ? nodePreviewIds(map, id) : []
  const frames = map.runs.flatMap((r) => r.products)

  return (
    <article
      ref={article}
      className="workflow-node"
      style={{
        width: collapsed ? COLLAPSED_WIDTH : NODE_WIDTH,
        minHeight: collapsed ? undefined : geometry.height,
      }}
      data-node-id={id}
      aria-label={`${task.label} 노드`}
      data-collapsed={collapsed}
      data-selected={selected}
      data-running={run?.state === "running"}
      data-dragging={dragging}
      data-connection-target={connectionTarget !== null}
      data-diagnostic={nodeIssue?.severity}
    >
      {collapsed ? (
        <>
          <button
            className="node-heading node-pill"
            aria-label={`${task.label} 이동`}
            aria-pressed={selected}
            title={description}
            onClick={() => choose(id)}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setCollapsed([id], false)
            }}
          >
            {status}
            {icon}
            <strong title={titleHint}>{title}</strong>
            {output.kind === "result" && (
              <span className="node-pill-count">{count(output)}</span>
            )}
          </button>
          {geometry.roles.map((slot, i) => inputHandle(slot, i > 0))}
          {geometry.primary &&
            outputHandleElement("output", primaryName, output)}
          {outputSlots.map(({ slot, result, name }, i) =>
            outputHandleElement(
              slot.handleId,
              name,
              result,
              geometry.primary || i > 0
            )
          )}
          {geometry.members.map((m) => memberHandleElement(m, true))}
          {params.map((row, i) => paramHandle(row, geometry.roles.length > 0 || i > 0))}
          {geometry.values.map((row, i) =>
            valueHandle(row.handleId, row.name, geometry.primary || outputSlots.length > 0 || i > 0)
          )}
          {geometry.psetOutput && valueHandle(PSET_OUTPUT, task.draft.pset?.name ?? "pset")}
        </>
      ) : (
        <>
          <header className="node-header">
            <button
              className="node-heading"
              aria-label={`${task.label} 이동`}
              aria-pressed={selected}
              onClick={() => choose(id)}
            >
              {status}
              {icon}
              <span className="node-title">
                <strong title={titleHint}>{title}</strong>
                <span title={description}>{description}</span>
              </span>
            </button>
            <span className="node-actions">
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
              <Button
                className="node-collapse nodrag nopan"
                size="icon-sm"
                variant="ghost"
                aria-label={`${task.label} 접기`}
                title="접기"
                onClick={(e) => {
                  e.stopPropagation()
                  setCollapsed([id], true)
                }}
              >
                <ChevronsDownUp />
              </Button>
            </span>
          </header>
          {geometry.showInputs && <div className="node-section node-inputs">
            {geometry.roles.length ? (
              geometry.roles.map((slot) => {
                const a = assigned(map, task, slot.role)
                const links = map.connections.filter(
                  (c) =>
                    c.target === id &&
                    c.role === slot.role &&
                    (c.source.kind !== "files" || c.source.ids.length > 0)
                )
                // A link from one member of a bundle names its value.
                const members = links.flatMap((c) =>
                  c.source.kind !== "files" && c.source.partition
                    ? [c.source.partition.value]
                    : []
                )
                const summary =
                  (task.draft.textInputs?.[slot.name]?.trim()
                    ? "직접 입력 " +
                      task.draft.textInputs[slot.name].trim().split("\n")
                        .length +
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
                            ? `파일 ${c.source.ids.length}개`
                            : innerPortLabel(map, c.source) ??
                              map.tasks.find((t) => "taskId" in c.source && t.id === c.source.taskId)
                                ?.label ?? "실행 결과"
                        )
                        .join(", ")
                    : a.ids.length === 1
                      ? rows.find((f) => f.id === a.ids[0])?.label ||
                        "파일 1개"
                      : a.ids.length
                        ? `파일 ${a.ids.length}개`
                        : "미지정")
                const enabled = roleActive(task, slot.role, catalog)
                const fromFiles = links.some((c) => {
                  const from = map.tasks.find(
                    (t) => "taskId" in c.source && t.id === c.source.taskId
                  )
                  return isSourceNode(
                    catalog.tasks.find((s) => s.name === from?.task)
                  )
                })
                // A file source's files are ready without running it.
                // A container's item or lane arrives as it runs.
                const pending =
                  !fromFiles &&
                  links.some((c) => c.source.kind === "pending" && !isContainerId(map, c.source.taskId))
                const key = ccdTasks.has(task.task)
                  ? calibrationLabels[slot.role] || slot.role
                  : slot.role
                const about = `${slot.label || slot.name}${slot.group ? ` ${groupLabel(slot.group)}` : ""}`
                const shown = pending ? `${summary} 출력 대기` : summary
                return (
                  <div
                    className="node-input-row"
                    key={slot.name}
                    data-inactive={!enabled}
                    data-empty={summary === "미지정" || undefined}
                    data-expression={
                      !!task.expressions[slot.role] || undefined
                    }
                    data-connection-target={connectionTarget === slot.name}
                  >
                    {inputHandle(slot)}
                    <Tooltip disabled={connecting}>
                      <TooltipTrigger
                        render={<button />}
                        className="node-input nodrag nopan"
                        data-input-role={slot.name}
                        aria-label={`${task.label} ${slot.role} 설정`}
                        onClick={(e) => {
                          e.stopPropagation()
                          if (clickStart) {
                            if (enabled && isConnectable)
                              inputHandles.current.get(slot.name)?.click()
                          } else {
                            choose(id)
                            onInput?.(id, slot.name)
                          }
                        }}
                      >
                        <span className="node-input-label">{key}</span>
                        <span className="node-input-source">
                          {fromFiles && (
                            <File
                              className="node-input-file"
                              aria-hidden="true"
                            />
                          )}
                          {shown}
                          {members.map((value, i) => (
                            <ValueChip key={i} value={value} />
                          ))}
                        </span>
                        {!enabled && (
                          <span className="node-input-flag">비활성</span>
                        )}
                      </TooltipTrigger>
                      {/* The row's tooltip also carries its key and value in full, in case either is cut off. */}
                      <TooltipContent className="flex-col items-start">
                        {about !== key && <span>{key}</span>}
                        <span>{about}</span>
                        <span>{[shown, ...members.map(valueLabel)].join(" ")}</span>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                )
              })
            ) : (
              <p className="node-no-input">입력 없음</p>
            )}
          </div>}
          {params.length > 0 && (
            <div className="node-section node-params">
              {params.map((row) => {
                const { text, from, fromId: sourceId } = paramText(row)
                return (
                <div
                  className="node-input-row node-param-row"
                  key={row.handleId}
                  data-connection-target={connectionTarget === row.handleId}
                >
                  {paramHandle(row)}
                  <button
                    className="node-input node-param nodrag nopan"
                    aria-label={`${task.label} ${row.key} 설정`}
                    onClick={(e) => {
                      e.stopPropagation()
                      if (clickStart) {
                        document
                          .querySelector<HTMLElement>(
                            `[data-node-id="${CSS.escape(id)}"] .react-flow__handle[data-handleid="${CSS.escape(row.handleId)}"]`
                          )
                          ?.click()
                      } else if (sourceId && hiddenNodes.has(sourceId)) {
                        // A value from a hidden node opens that node, shown while selected.
                        choose(sourceId)
                      } else {
                        choose(id)
                        onParameter?.(id, row.key)
                      }
                    }}
                  >
                    <span className="node-param-name" data-full-text={row.key}>{row.key}</span>
                    <span
                      className="node-param-value"
                      data-full-text={from ? `${text}\n${from}에서 받은 값` : text}
                    >
                      {text}
                    </span>
                  </button>
                </div>
                )
              })}
            </div>
          )}
          {(geometry.primary || outputSlots.length > 0 || geometry.values.length > 0 || geometry.psetOutput) && (
            <div className="node-section node-outputs">
              {geometry.primary &&
                outputRow("output", primaryName, output, "결과")}
              {outputSlots.map(({ slot, result, name }) =>
                outputRow(slot.handleId, name, result, "이름 없는 포트")
              )}
              {geometry.values.map((row) => {
                const value = formatValue(values?.outputs[`${id}:${row.name}`])
                return (
                  <div className="node-output-row" key={row.handleId}>
                    <span className="node-output-name" data-full-text={row.name}>{row.name}</span>
                    <span className="node-output-count node-value-text" data-full-text={value}>
                      {value}
                    </span>
                    {valueHandle(row.handleId, row.name)}
                  </div>
                )
              })}
              {geometry.psetOutput && (
                <div className="node-output-row">
                  <span className="node-output-name" data-full-text={task.draft.pset?.name ?? "pset"}>
                    {task.draft.pset?.name ?? "pset"}
                  </span>
                  {valueHandle(PSET_OUTPUT, task.draft.pset?.name ?? "pset")}
                </div>
              )}
            </div>
          )}
          {preview.length > 0 && (
            <div className="node-section node-preview">
              {preview.slice(0, 3).map((pid) => {
                const frame = frames.find((f) => f.id === pid)
                return (
                  <button
                    key={pid}
                    className="node-thumb nodrag nopan"
                    aria-label={`${frame?.label ?? "결과"} 열기`}
                    title={frame?.label}
                    onClick={(e) => {
                      e.stopPropagation()
                      choose(id)
                      if (frame) open?.(frame)
                    }}
                  >
                    <img
                      src={`/api/image?id=${encodeURIComponent(pid)}&size=104`}
                      alt=""
                      loading="lazy"
                      draggable={false}
                    />
                  </button>
                )
              })}
              {preview.length > 3 && (
                <span className="node-preview-more">
                  외 {preview.length - 3}개
                </span>
              )}
            </div>
          )}
        </>
      )}
    </article>
  )
})
