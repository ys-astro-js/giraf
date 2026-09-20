import { type CSSProperties, createContext, useContext, useEffect, useMemo, useState } from "react"
import {
  ReactFlow,
  BaseEdge,
  type EdgeProps,
  Handle,
  Position,
  Panel,
  type NodeProps,
} from "@xyflow/react"
import { ArrowUpFromLine, ArrowDownFromLine, GitCommitHorizontal, Network } from "lucide-react"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { WorkflowToolButton, WorkflowZoomControls } from "./workflow-tools"
import {
  dependencyGraph,
  layoutDependencies,
  type DependencyFlowNode,
  type DependencyGraph,
  type DependencyDirections,
} from "@/lib/node-dependencies"
import type { Instance, TaskMap } from "@/lib/task-map"
import type { Catalog } from "@/lib/workbench"

const SelectNode = createContext<((id: string) => void) | undefined>(undefined)
function DependencyNode({ id, data }: NodeProps<DependencyFlowNode>) {
  const select = useContext(SelectNode)
  return (
    <button
      type="button"
      onClick={() => select?.(id)}
      aria-label={`${data.label} 노드로 이동`}
      className="dependency-node"
      data-current={data.current}
      style={{ "--dependency-color": data.color } as CSSProperties}
    >
      {data.inputPorts.map((port) => (
        <Handle
          key={port.id}
          type="target"
          position={Position.Top}
          id={port.id}
          style={{ left: port.x }}
        />
      ))}
      <div className="dependency-node-label">
        <strong title={data.label}>{data.label}</strong>
        <span title={data.command}>{data.command}</span>
      </div>
      {data.outputs.length > 0 && (
        <div className="dependency-outputs">
          {data.sourcePorts.map((port) => (
            <span className="dependency-output" key={port.id} title={port.name}>
              {port.name}
            </span>
          ))}
        </div>
      )}
      {data.sourceHandles.map((port) => (
        <Handle
          key={port.id}
          type="source"
          position={Position.Bottom}
          id={port.id}
          style={{ left: port.x }}
        />
      ))}
    </button>
  )
}
const nodeTypes = { dependency: DependencyNode }
function DependencyEdge({ id, data, markerEnd, style }: EdgeProps) {
  const points = data?.points as { x: number; y: number }[] | undefined
  if (!points?.length) return null
  const path = points
    .map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`)
    .join(" ")
  return (
    <BaseEdge
      id={id}
      path={path}
      markerEnd={markerEnd}
      style={style}
      interactionWidth={16}
    />
  )
}
const edgeTypes = { dependency: DependencyEdge }
const dependencyFitOptions = {
  padding: {
    top: "16px" as const,
    right: "16px" as const,
    bottom: "64px" as const,
    left: "16px" as const,
  },
  maxZoom: 1,
}
function GraphControls({
  scope,
  onScopeChange,
  directions,
  onDirectionsChange,
}: {
  scope: string
  onScopeChange: (scope: string) => void
  directions: DependencyDirections
  onDirectionsChange: (directions: DependencyDirections) => void
}) {
  return (
    <Panel
      position="bottom-left"
      className="workflow-tools dependency-tools"
      role="group"
      aria-label="의존성 도구"
    >
      <div className="dependency-view-tools">
        <WorkflowToolButton
          variant="outline"
          size="icon-sm"
          tooltipSide="top"
          label={scope === "direct" ? "전체 경로 보기" : "연결된 노드만 보기"}
          onClick={() => onScopeChange(scope === "direct" ? "all" : "direct")}
        >
          {scope === "direct" ? <Network /> : <GitCommitHorizontal />}
        </WorkflowToolButton>
        <ToggleGroup
          multiple
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="표시 방향"
          value={Object.entries(directions).filter(([, enabled]) => enabled).map(([direction]) => direction)}
          onValueChange={(value) => onDirectionsChange({
            previous: value.includes("previous"),
            next: value.includes("next"),
          })}
        >
          <Tooltip>
            <TooltipTrigger render={<ToggleGroupItem value="previous" className="size-8 p-0!" />} aria-label="이전 노드">
              <ArrowUpFromLine />
            </TooltipTrigger>
            <TooltipContent side="top">이전 노드</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger render={<ToggleGroupItem value="next" className="size-8 p-0!" />} aria-label="이후 노드">
              <ArrowDownFromLine />
            </TooltipTrigger>
            <TooltipContent side="top">이후 노드</TooltipContent>
          </Tooltip>
        </ToggleGroup>
      </div>
      <WorkflowZoomControls
        orientation="horizontal"
        fitOptions={dependencyFitOptions}
      />
    </Panel>
  )
}
type Props = {
  map: TaskMap
  catalog: Catalog
  task: Instance
  onSelect?: (id: string) => void
}
export function NodeDependencies({ map, catalog, task, onSelect }: Props) {
  const [scope, setScope] = useState("direct")
  const [directions, setDirections] = useState<DependencyDirections>({ previous: true, next: true })
  const [highlight, setHighlight] = useState<{ node?: string; edge?: string }>(
    {}
  )
  // Persisting canvas pan/zoom replaces map without changing dependency content.
  // Compare that content so the existing graph and viewport stay mounted.
  const graphKey = useMemo(
    () => JSON.stringify(dependencyGraph(map, catalog, task.id, scope === "all", directions)),
    [map, catalog, task.id, scope, directions]
  )
  const [result, setResult] = useState<{
    source: string
    graph?: DependencyGraph
    error?: string
  }>()
  useEffect(() => {
    let cancelled = false
    const graph: DependencyGraph = JSON.parse(graphKey)
    layoutDependencies(graph)
      .then((layout) => {
        if (!cancelled) setResult({ source: graphKey, graph: layout })
      })
      .catch(() => {
        if (!cancelled)
          setResult({
            source: graphKey,
            error: "의존성 그래프를 배치하지 못했습니다.",
          })
      })
    return () => {
      cancelled = true
    }
  }, [graphKey])
  const ready = result?.source === graphKey ? result : undefined
  return (
    <div className="dependency-panel" aria-label="노드 의존성">
      <div
        className="dependency-canvas"
        onFocusCapture={(event) => {
          const node = event.target.closest<HTMLElement>(".react-flow__node")
          setHighlight(node?.dataset.id ? { node: node.dataset.id } : {})
        }}
        onBlurCapture={() => setHighlight({})}
      >
        {ready?.error ? (
          <p role="alert" className="dependency-message">
            {ready.error}
          </p>
        ) : ready?.graph ? (
          <SelectNode.Provider value={onSelect}>
            <ReactFlow<DependencyFlowNode>
              key={scope + task.id}
              nodes={ready.graph.nodes}
              edges={ready.graph.edges.map((edge) => {
                const active =
                  highlight.edge === edge.id ||
                  highlight.node === edge.source ||
                  highlight.node === edge.target
                const color = edge.style?.stroke ?? "var(--muted-foreground)"
                return {
                  ...edge,
                  markerEnd: typeof edge.markerEnd === "object"
                    ? { ...edge.markerEnd, color }
                    : edge.markerEnd,
                  zIndex: active ? 1 : 0,
                  style: {
                    ...edge.style,
                    stroke: color,
                    strokeWidth: active ? 2.5 : 1.25,
                    opacity:
                      (highlight.node || highlight.edge) && !active
                        ? 0.15
                        : edge.style?.opacity,
                  },
                }
              })}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              proOptions={{ hideAttribution: true }}
              fitView={scope === "all"}
              fitViewOptions={dependencyFitOptions}
              onInit={(flow) => {
                if (scope === "all") return
                const current = ready.graph!.nodes.find(
                  (node) => node.id === task.id
                )!
                void flow.setCenter(
                  current.position.x + current.width! / 2,
                  current.position.y + current.height! / 2,
                  { zoom: 1.1 }
                )
              }}
              onNodeMouseEnter={(_, node) => setHighlight({ node: node.id })}
              onNodeMouseLeave={() => setHighlight({})}
              onEdgeMouseEnter={(_, edge) => setHighlight({ edge: edge.id })}
              onEdgeMouseLeave={() => setHighlight({})}
              minZoom={0.02}
              maxZoom={1.5}
              nodesDraggable={false}
              nodesConnectable={false}
              edgesFocusable={false}
              nodesFocusable={false}
              elementsSelectable={false}
              deleteKeyCode={null}
              aria-label="노드 의존성 그래프"
            >
              <GraphControls scope={scope} onScopeChange={setScope} directions={directions} onDirectionsChange={setDirections} />
              {!ready.graph.edges.length && directions.previous && directions.next && (
                <Panel position="top-center">
                  <p className="dependency-message">연결된 노드가 없습니다.</p>
                </Panel>
              )}
            </ReactFlow>
          </SelectNode.Provider>
        ) : null}
      </div>
    </div>
  )
}
