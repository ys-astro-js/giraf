import type {
  AddPanelOptions,
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
} from "dockview-react"

/*
 * The workbench grid: the workflow canvas fixed on the left, and a column on
 * the right where node windows sit above viewers. Each group in the column
 * holds tabs of one kind. dockview lays the grid out in proportions, so the
 * column would drift as the workbench resizes; `fitColumn` gives it back its
 * width in pixels after every layout and the canvas takes the difference.
 *
 * These helpers only use dockview, so tests can run them on a real grid.
 */

/** What a window shows; tabs gather only with tabs of their own kind. */
export type Kind = "canvas" | "inspector" | "viewer"

/** The kind of each window component. */
export const KINDS: Record<string, Kind> = {
  workflow: "canvas",
  inspector: "inspector",
  viewer: "viewer",
  display: "viewer",
}

/** The canvas window's id: one, fixed, never a tab or a drop target. */
export const CANVAS = "workflow"

/** The column's width when nobody has set it, and its limits. */
export const COLUMN = 384
export const MIN_COLUMN = 240
/** The canvas keeps at least this much width beside the column. */
export const MIN_CANVAS = 320

export const kindOf = (panel: IDockviewPanel): Kind | undefined =>
  KINDS[panel.view.contentComponent]

/** A group's kind: the kind of the tabs it holds. */
export const groupKind = (group: DockviewGroupPanel): Kind | undefined =>
  group.panels[0] && kindOf(group.panels[0])

export const canvasGroup = (dock: DockviewApi) => dock.getPanel(CANVAS)?.group

export const isDocked = (group: DockviewGroupPanel) =>
  group.api.location.type === "grid"

type GridNode =
  | { type: "leaf"; data: { id: string } }
  | { type: "branch"; data: GridNode[] }

/** Group ids in the grid's reading order: left to right, top to bottom. */
function gridOrder(node: GridNode): string[] {
  return node.type === "leaf" ? [node.data.id] : node.data.flatMap(gridOrder)
}

/** The groups in the right column, top to bottom. */
export function columnGroups(dock: DockviewApi) {
  const canvas = canvasGroup(dock)
  const order = gridOrder(dock.toJSON().grid.root as GridNode)
  return order
    .map((id) => dock.getGroup(id) as DockviewGroupPanel | undefined)
    .filter(
      (group): group is DockviewGroupPanel =>
        !!group && group !== canvas && isDocked(group)
    )
}

/** Any group in the column: they all share its width. */
const inColumn = (dock: DockviewApi) => {
  const canvas = canvasGroup(dock)
  return dock.groups.find((group) => group !== canvas && isDocked(group))
}

/** The column width that fits a workbench `total` pixels wide. */
export const fitWidth = (width: number, total: number) =>
  Math.max(MIN_COLUMN, Math.min(width, total - MIN_CANVAS))

/** The column's width now, if it holds any group. */
export function columnWidth(dock: DockviewApi) {
  return inColumn(dock)?.width
}

/**
 * Gives the column its width back after dockview laid the grid out by
 * proportions; the canvas takes the rest. Nothing while a group is
 * maximized: the column is hidden then, and comes back as it was.
 */
export function fitColumn(dock: DockviewApi, width: number) {
  if (dock.hasMaximizedGroup()) return
  const group = inColumn(dock)
  if (!group) return
  const target = fitWidth(width, dock.width)
  if (Math.abs(group.width - target) >= 1) group.api.setSize({ width: target })
}

/** A place in the grid: beside a group, or in it as a tab ("center"). */
export type DockTarget = {
  group: DockviewGroupPanel
  position: "center" | "right" | "top" | "bottom"
}

/**
 * Where a window of a kind docks: as a tab in its kind's group, or as a new
 * group in the column, node windows above viewers.
 */
export function dockTarget(
  dock: DockviewApi,
  kind: Kind
): DockTarget | undefined {
  const groups = columnGroups(dock)
  const same = groups.find((group) => groupKind(group) === kind)
  if (same) return { group: same, position: "center" }
  if (!groups.length) {
    const canvas = canvasGroup(dock)
    return canvas && { group: canvas, position: "right" }
  }
  return kind === "inspector"
    ? { group: groups[0], position: "top" }
    : { group: groups[groups.length - 1], position: "bottom" }
}

const DIRECTIONS = { right: "right", top: "above", bottom: "below" } as const

/** `dockTarget` as dockview's position for a new panel. */
export function dockPosition(
  dock: DockviewApi,
  kind: Kind
): AddPanelOptions["position"] {
  const target = dockTarget(dock, kind)
  if (!target) return undefined
  return target.position === "center"
    ? { referenceGroup: target.group }
    : { referenceGroup: target.group, direction: DIRECTIONS[target.position] }
}

/** Hides the canvas group's header and keeps drops out of it. */
export function fixCanvas(dock: DockviewApi) {
  const group = canvasGroup(dock)
  if (!group) return
  group.header.hidden = true
  group.locked = "no-drop-target"
}

type NewWindow = { id: string; component: string; title: string }

/** The starting layout: the canvas, the node window above a viewer. */
export function buildDefault(dock: DockviewApi, windows: NewWindow[]) {
  dock.clear()
  for (const window of windows) {
    const kind = KINDS[window.component]
    dock.addPanel({
      ...window,
      position: kind === "canvas" ? undefined : dockPosition(dock, kind),
    })
  }
  fixCanvas(dock)
}

export type DropPlace = {
  /** Where on the target: a tab, the header's empty space, the content, or
   *  the edge of the whole layout. */
  on: "tab" | "header_space" | "content" | "edge"
  position: "top" | "bottom" | "left" | "right" | "center"
  target?: DockviewGroupPanel
  /** The dragged window: one tab, or a whole group. */
  source: { panel?: IDockviewPanel; group?: DockviewGroupPanel }
}

/**
 * Whether a dragged window may land there: as a tab only among its own
 * kind, above or below a group in the column, or as the column itself when
 * there is none. Never on the canvas, and never beside the column.
 */
export function canDrop(dock: DockviewApi, place: DropPlace) {
  const kind = place.source.panel
    ? kindOf(place.source.panel)
    : place.source.group && groupKind(place.source.group)
  if (!kind || kind === "canvas") return false
  const { target, position } = place
  if (place.on === "edge")
    return position === "right" && !columnGroups(dock).length
  if (!target || target === canvasGroup(dock)) return false
  if (position === "center" || place.on !== "content")
    return groupKind(target) === kind
  return isDocked(target) && (position === "top" || position === "bottom")
}
