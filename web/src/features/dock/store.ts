import { create } from "zustand"
import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
} from "dockview-react"
import { PANELS, type PanelId } from "./panels"
import { buildPreset, type PresetId } from "./presets"

export type Edge = "left" | "right" | "bottom"
export const EDGES: Edge[] = ["left", "right", "bottom"]

/** A window taken out of the layout into an edge strip. */
export type MinimizedWindow = {
  id: string
  component: string
  title: string
  params?: Record<string, unknown>
  edge: Edge
}

/** What a locked window keeps showing instead of following the selection. */
export type WindowParams = { locked?: string }

type DockState = {
  api?: DockviewApi
  edges: Record<Edge, boolean>
  activeGroup?: string
  maximized: boolean
  minimized: MinimizedWindow[]
  /** Bumped on every structural change so window chrome re-reads it. */
  revision: number
}

export const useDock = create<DockState>()(() => ({
  edges: { left: false, right: false, bottom: false },
  maximized: false,
  minimized: [],
  revision: 0,
}))

const LAYOUT_KEY = "giraf-dock-layout"
const LAYOUT_VERSION = 1
type SavedLayout = {
  version: number
  layout: unknown
  minimized: MinimizedWindow[]
}

const api = () => useDock.getState().api

export function edgeOf(group: DockviewGroupPanel): Edge | undefined {
  return EDGES.find((edge) => api()?.getEdgeGroup(edge)?.id === group.id)
}

/**
 * Shows an edge at full size. dockview collapses an edge to a strip when it
 * empties, and showing it again does not expand it.
 */
export function showEdge(dock: DockviewApi, edge: Edge) {
  const group = dock.getEdgeGroup(edge)
  if (!group) return
  dock.setEdgeGroupVisible(edge, true)
  if (group.isCollapsed()) group.expand()
}

export const isFloating = (group: DockviewGroupPanel) =>
  group.api.location.type === "floating"

/**
 * Tab strips appear only when a group holds several windows; floating
 * windows keep theirs as the title bar. Empty edges hide themselves.
 */
function syncHeaders(dock: DockviewApi) {
  for (const group of dock.groups) {
    // Tabs always sit on top, also in side edges.
    if (group.api.getHeaderPosition() !== "top")
      group.api.setHeaderPosition("top")
    group.model.header.hidden = group.panels.length <= 1 && !isFloating(group)
  }
  for (const edge of EDGES) {
    const group = dock.getEdgeGroup(edge)
    if (
      group &&
      !dock.getGroup(group.id)?.panels.length &&
      dock.isEdgeGroupVisible(edge)
    )
      dock.setEdgeGroupVisible(edge, false)
  }
}

/** Re-reads the layout facts the rest of the app shows. */
export function syncDock() {
  const dock = api()
  if (!dock) return
  syncHeaders(dock)
  useDock.setState((state) => ({
    edges: Object.fromEntries(
      EDGES.map((edge) => [
        edge,
        !!dock.getEdgeGroup(edge) && dock.isEdgeGroupVisible(edge),
      ])
    ) as Record<Edge, boolean>,
    activeGroup: dock.activeGroup?.id,
    maximized: dock.hasMaximizedGroup(),
    revision: state.revision + 1,
  }))
}

function homeGroup(component: string) {
  const home = PANELS[component as PanelId]?.home ?? "center"
  return home === "center" ? undefined : api()?.getEdgeGroup(home)
}

function addWindow(
  id: string,
  component: string,
  title: string,
  params: Record<string, unknown> = {},
  beside?: DockviewGroupPanel
) {
  const dock = api()!
  const edgeGroup = beside ? undefined : homeGroup(component)
  const workflow = dock.getPanel("workflow")
  const panel = dock.addPanel({
    id,
    component,
    title,
    params,
    position: beside
      ? { referenceGroup: beside }
      : edgeGroup
        ? { referenceGroup: edgeGroup.id }
        : workflow
          ? { referencePanel: workflow, direction: "right" }
          : undefined,
  })
  const edge = edgeOf(panel.group)
  if (edge) showEdge(dock, edge)
  return panel
}

const isLocked = (panel: IDockviewPanel) =>
  !!(panel.params as WindowParams | undefined)?.locked

/**
 * The window of a following kind that tracks the selection: an unlocked one
 * if any, else a new one opened beside the locked ones.
 */
function follower(component: PanelId) {
  const dock = api()!
  const same = dock.panels.filter(
    (panel) => panel.view.contentComponent === component
  )
  const free = same.find((panel) => !isLocked(panel))
  if (free) return free
  let n = 2
  while (dock.getPanel(`${component}-${n}`)) n++
  return addWindow(
    same.length ? `${component}-${n}` : component,
    component,
    PANELS[component].title,
    {},
    same[0]?.group
  )
}

/** Shows a window wherever it is: restores, re-opens or un-hides its edge. */
export function revealPanel(id: PanelId) {
  const dock = api()
  if (!dock) return
  const minimized = useDock
    .getState()
    .minimized.find(
      (item) =>
        item.id === id ||
        (PANELS[id].follows &&
          item.component === id &&
          !(item.params as WindowParams | undefined)?.locked)
    )
  if (minimized) {
    restoreWindow(minimized.id)
    return
  }
  const panel = PANELS[id].follows
    ? follower(id)
    : (dock.getPanel(id) ?? addWindow(id, id, PANELS[id].title))
  const edge = edgeOf(panel.group)
  if (edge) showEdge(dock, edge)
  panel.api.setActive()
  syncDock()
}

/** The toolbar's edge toggles: show or hide everything docked there. */
export function toggleEdge(edge: Edge) {
  const dock = api()
  if (!dock) return
  const group = dock.getEdgeGroup(edge)
  const visible = !!group && dock.isEdgeGroupVisible(edge)
  if (visible) dock.setEdgeGroupVisible(edge, false)
  else if (group && dock.getGroup(group.id)?.panels.length) showEdge(dock, edge)
  else {
    const home = (Object.keys(PANELS) as PanelId[]).find(
      (id) => PANELS[id].home === edge
    )
    if (home) revealPanel(home)
  }
  syncDock()
}

/** Current targets of following windows, for locking them in place. */
const lockTargets = new Map<string, () => string | undefined>()
export function registerLockTarget(
  panelId: string,
  target: () => string | undefined
) {
  lockTargets.set(panelId, target)
  return () => {
    if (lockTargets.get(panelId) === target) lockTargets.delete(panelId)
  }
}

/**
 * Built-in windows have no other way back, so only the extra windows a
 * lock opened can close; the rest minimize.
 */
export function canClose(panel: IDockviewPanel) {
  return panel.id !== panel.view.contentComponent
}

export function canLock(panel: IDockviewPanel) {
  return !!PANELS[panel.view.contentComponent as PanelId]?.follows
}

export function toggleLock(panel: IDockviewPanel) {
  const locked = isLocked(panel) ? undefined : lockTargets.get(panel.id)?.()
  panel.api.updateParameters({ ...panel.params, locked })
  syncDock()
  saveLayout()
}

/** The edge nearest the window, where its minimized icon waits. */
function nearestEdge(panel: IDockviewPanel): Edge {
  const edge = edgeOf(panel.group)
  if (edge) return edge
  const box = panel.group.element.getBoundingClientRect()
  const x = box.left + box.width / 2
  const y = box.top + box.height / 2
  const distances: [Edge, number][] = [
    ["left", x],
    ["right", window.innerWidth - x],
    ["bottom", window.innerHeight - y],
  ]
  return distances.sort((a, b) => a[1] - b[1])[0][0]
}

export function minimizeWindow(panel: IDockviewPanel) {
  if (!api()) return
  const item: MinimizedWindow = {
    id: panel.id,
    component: panel.view.contentComponent,
    title: panel.title ?? panel.id,
    params: panel.params,
    edge: nearestEdge(panel),
  }
  useDock.setState((state) => ({ minimized: [...state.minimized, item] }))
  panel.api.close()
  syncDock()
  saveLayout()
}

export function restoreWindow(id: string) {
  const item = useDock.getState().minimized.find((entry) => entry.id === id)
  const dock = api()
  if (!item || !dock) return
  useDock.setState((state) => ({
    minimized: state.minimized.filter((entry) => entry !== item),
  }))
  const edgeGroup = dock.getEdgeGroup(item.edge)
  const panel = edgeGroup
    ? dock.addPanel({
        id: item.id,
        component: item.component,
        title: item.title,
        params: item.params,
        position: { referenceGroup: edgeGroup.id },
      })
    : addWindow(item.id, item.component, item.title, item.params)
  const edge = edgeOf(panel.group)
  if (edge) showEdge(dock, edge)
  panel.api.setActive()
  syncDock()
  saveLayout()
}

export function canMaximize(panel: IDockviewPanel) {
  return !edgeOf(panel.group) && !isFloating(panel.group)
}

export function toggleMaximized(panel: IDockviewPanel) {
  const dock = api()
  if (!dock) return
  if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup()
  else dock.maximizeGroup(panel)
  syncDock()
}

/**
 * A drag in flight, so a drop that the dock handled (a move) is not also
 * turned into a floating window when the drag ends.
 */
let dragged: IDockviewPanel | undefined
export function beginWindowDrag(panel: IDockviewPanel) {
  dragged = panel
}
export function windowMoved() {
  dragged = undefined
}
/** A window dropped where nothing docks it becomes a floating window. */
export function endWindowDrag(event: DragEvent) {
  const panel = dragged
  dragged = undefined
  if (!panel || event.dataTransfer?.dropEffect !== "none") return
  floatWindow(panel, event.clientX, event.clientY)
}

function floatWindow(panel: IDockviewPanel, x: number, y: number) {
  const dock = api()
  if (!dock || isFloating(panel.group)) return
  const root = document.querySelector(".dock-root")?.getBoundingClientRect()
  const width = 480
  const height = 360
  dock.addFloatingGroup(panel, {
    position: {
      left: Math.max(0, x - (root?.left ?? 0) - width / 2),
      top: Math.max(0, y - (root?.top ?? 0) - 16),
    },
    width,
    height,
  })
  syncDock()
}

export function saveLayout() {
  const dock = api()
  if (!dock) return
  try {
    const saved: SavedLayout = {
      version: LAYOUT_VERSION,
      layout: dock.toJSON(),
      minimized: useDock.getState().minimized,
    }
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(saved))
  } catch {
    // The layout still works for this session without storage.
  }
}

/** Restores the saved layout, or builds the default preset. */
export function loadLayout(dock: DockviewApi) {
  useDock.setState({ api: dock })
  try {
    const saved = JSON.parse(
      localStorage.getItem(LAYOUT_KEY) || "null"
    ) as SavedLayout | null
    if (saved?.version === LAYOUT_VERSION) {
      dock.fromJSON(saved.layout as Parameters<DockviewApi["fromJSON"]>[0])
      if (dock.getPanel("workflow")) {
        useDock.setState({
          minimized: saved.minimized.filter(
            (item) => item.component in PANELS && !dock.getPanel(item.id)
          ),
        })
        ensureWindows(dock)
        syncDock()
        return
      }
    }
  } catch {
    // A layout from an older build falls back to the default below.
  }
  applyPreset("default")
}

/**
 * Every built-in window stays reachable: one missing from both the layout
 * and the minimized strips (an older or damaged layout) returns home.
 */
function ensureWindows(dock: DockviewApi) {
  const minimized = useDock.getState().minimized
  for (const id of Object.keys(PANELS) as PanelId[]) {
    const present =
      dock.panels.some((panel) => panel.view.contentComponent === id) ||
      minimized.some((item) => item.component === id)
    if (present) continue
    const panel = addWindow(id, id, PANELS[id].title)
    const edge = edgeOf(panel.group)
    if (edge === "bottom") dock.setEdgeGroupVisible(edge, false)
  }
}

export function applyPreset(preset: PresetId) {
  const dock = api()
  if (!dock) return
  if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup()
  dock.clear()
  useDock.setState({ minimized: [] })
  buildPreset(dock, preset)
  syncDock()
  saveLayout()
}
