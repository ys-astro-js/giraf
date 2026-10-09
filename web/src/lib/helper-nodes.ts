/**
 * Hiding GIRAF's helper nodes on the canvas, per kind (노드 보기 menu).
 *
 * File nodes (`pass-files`, `save-files`) and value nodes (`value-constant`,
 * `value-header`, `value-compute`, `pset`) each have a level in `map.view`:
 * none shows everything, "edges" hides their connections until the pointer or
 * the selection reaches an end, "nodes" hides the nodes and their connections.
 * Hidden nodes keep their places; a dotted bypass edge keeps a dependency
 * between shown nodes visible, and selecting a node shows the hidden nodes it
 * reads from.
 */
import type { Edge } from "@xyflow/react"
import type { TaskMap } from "./task-map/model"
import { isGirafNode, type Catalog, type Spec } from "./workbench"

export type HelperKind = "files" | "values"
export type HelperLevel = "edges" | "nodes"
type View = TaskMap["view"]

const RUNS: Record<HelperKind, NonNullable<Spec["run"]>[]> = {
  files: ["pass-files", "save-files"],
  values: ["value-constant", "value-header", "value-compute", "pset"],
}

/** The helper kind of a node, by its schema `run`; undefined for every other node. */
export function helperKind(spec: Spec | undefined): HelperKind | undefined {
  if (!isGirafNode(spec) || !spec?.run) return undefined
  return (Object.keys(RUNS) as HelperKind[]).find((kind) =>
    RUNS[kind].includes(spec.run!)
  )
}

export const helperLevel = (view: View, kind: HelperKind) =>
  kind === "files" ? view.fileNodes : view.valueNodes

/** Nodes whose kind is set to "nodes"; the selection may still show some (peekedHelpers). */
export function hiddenHelpers(map: TaskMap, catalog: Catalog): Set<string> {
  if (map.view.fileNodes !== "nodes" && map.view.valueNodes !== "nodes")
    return new Set()
  return new Set(
    map.tasks
      .filter((task) => {
        const kind = helperKind(catalog.tasks.find((s) => s.name === task.task))
        return !!kind && helperLevel(map.view, kind) === "nodes"
      })
      .map((task) => task.id)
  )
}

type Link = Pick<
  Edge,
  "id" | "source" | "target" | "sourceHandle" | "targetHandle" | "hidden"
> &
  Partial<Pick<Edge, "type" | "style" | "data">>

/** The selected node, if hidden, and the hidden nodes it reads from, back to the first shown node. */
export function peekedHelpers(
  edges: Link[],
  hidden: Set<string>,
  selected: string
): Set<string> {
  const peek = new Set<string>()
  if (!selected || !hidden.size) return peek
  if (hidden.has(selected)) peek.add(selected)
  const queue = [selected]
  while (queue.length) {
    const id = queue.pop()!
    for (const edge of edges)
      if (
        !edge.hidden &&
        edge.target === id &&
        hidden.has(edge.source) &&
        !peek.has(edge.source)
      ) {
        peek.add(edge.source)
        queue.push(edge.source)
      }
  }
  return peek
}

/** The shown nodes reached from a hidden one through hidden nodes, with the edge that reaches each. */
function reach(
  edges: Link[],
  hidden: Set<string>,
  start: string,
  upstream: boolean
): Link[] {
  const found: Link[] = []
  const seen = new Set<string>()
  // Breadth first: the nearest shown node, in edge order, comes first.
  const queue = [start]
  while (queue.length) {
    const id = queue.shift()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const edge of edges) {
      if (edge.hidden || (upstream ? edge.target : edge.source) !== id) continue
      const next = upstream ? edge.source : edge.target
      if (hidden.has(next)) queue.push(next)
      else found.push(edge)
    }
  }
  return found
}

export const BYPASS_PREFIX = "bypass:"

/**
 * One dotted edge for each shown pair joined only through hidden nodes. It
 * leaves the output the first hidden node read and enters the row the last one
 * fed. A hidden node with nothing shown upstream draws none: the row shows its value.
 */
export function bypassEdges(edges: Link[], hidden: Set<string>): Edge[] {
  const bypass = new Map<string, Edge>()
  for (const last of edges) {
    if (last.hidden || hidden.has(last.target) || !hidden.has(last.source))
      continue
    for (const first of reach(edges, hidden, last.source, true)) {
      const id = `${BYPASS_PREFIX}${first.source}:${last.target}`
      if (bypass.has(id) || first.source === last.target) continue
      bypass.set(id, {
        id,
        type: last.type,
        zIndex: 1,
        source: first.source,
        target: last.target,
        sourceHandle: first.sourceHandle,
        targetHandle: last.targetHandle,
        // Only a view of the connections it stands for: never selected or removed.
        selectable: false,
        deletable: false,
        focusable: false,
        style: last.style,
        className: "workflow-edge-value",
        data: {
          bypass: true,
          role: last.data?.role,
          // The value the row takes, from the connection that feeds it.
          ...(last.data?.value ? { value: true, connection: last.id } : {}),
        },
      })
    }
  }
  return [...bypass.values()]
}

/**
 * The shown node each hidden node follows when nodes are laid out: the one it
 * feeds, else the one it reads from. Nodes joined to nothing shown are left out.
 */
export function helperAnchors(
  edges: Link[],
  hidden: Set<string>
): Map<string, string> {
  const anchors = new Map<string, string>()
  for (const id of hidden) {
    const to = reach(edges, hidden, id, false)[0]?.target
    const from = to ? undefined : reach(edges, hidden, id, true)[0]?.source
    if (to ?? from) anchors.set(id, (to ?? from)!)
  }
  return anchors
}

/** Saved maps from before the levels: a hidden-edges switch becomes the "edges" level. */
export function migrateHelperView(
  view: View & { hideFileEdges?: boolean; hideValueEdges?: boolean }
): View {
  const { hideFileEdges, hideValueEdges, ...rest } = view
  return {
    ...rest,
    ...(hideFileEdges && !rest.fileNodes ? { fileNodes: "edges" as const } : {}),
    ...(hideValueEdges && !rest.valueNodes
      ? { valueNodes: "edges" as const }
      : {}),
  }
}
