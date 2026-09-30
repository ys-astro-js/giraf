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

/** What a locked tab keeps showing instead of following the selection. */
export type WindowParams = { locked?: string }

/** A minimized window: its group stays in the layout, hidden in place. */
export type MinimizedWindow = { group: string; panels: string[] }

/** A built-in tab that was closed; it waits in the tray to come back. */
export type StowedTab = {
  id: string
  component: string
  title: string
  params?: Record<string, unknown>
}

type DockState = {
  api?: DockviewApi
  edges: Record<Edge, boolean>
  minimized: MinimizedWindow[]
  stowed: StowedTab[]
  /** The window filling the whole workbench, if any. */
  maximized?: string
  /** Bumped on every structural change so window chrome re-reads it. */
  revision: number
}

export const useDock = create<DockState>()(() => ({
  edges: { left: false, right: false, bottom: false },
  minimized: [],
  stowed: [],
  revision: 0,
}))

const LAYOUT_KEY = "giraf-dock-layout"
const LAYOUT_VERSION = 2
type SavedLayout = {
  version: number
  layout: unknown
  minimized: MinimizedWindow[]
  stowed: StowedTab[]
}

const api = () => useDock.getState().api
const root = () => document.querySelector(".dock-root")

export function edgeOf(group: DockviewGroupPanel): Edge | undefined {
  return EDGES.find((edge) => api()?.getEdgeGroup(edge)?.id === group.id)
}

export const isFloating = (group: DockviewGroupPanel) =>
  group.api.location.type === "floating"

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

/** Every window keeps its header row on top; empty edges hide. */
function syncHeaders(dock: DockviewApi) {
  for (const group of dock.groups) {
    if (group.api.getHeaderPosition() !== "top")
      group.api.setHeaderPosition("top")
    group.model.header.hidden = false
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
  const groups = new Set(dock.groups.map((group) => group.id))
  useDock.setState((state) => ({
    edges: Object.fromEntries(
      EDGES.map((edge) => [
        edge,
        !!dock.getEdgeGroup(edge) && dock.isEdgeGroupVisible(edge),
      ])
    ) as Record<Edge, boolean>,
    // A window whose tabs all moved away is no longer minimized.
    minimized: state.minimized.filter((item) => groups.has(item.group)),
    revision: state.revision + 1,
  }))
  placeMaximized()
}

function homeGroup(component: string) {
  const home = PANELS[component as PanelId]?.home ?? "center"
  return home === "center" || home === "float"
    ? undefined
    : api()?.getEdgeGroup(home)
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
  // Without the workflow, center windows join the main grid, not an edge.
  const grid = dock.groups.find(
    (group) => group.api.location.type === "grid" && !edgeOf(group)
  )
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
          : grid
            ? { referenceGroup: grid, direction: "right" }
            : { direction: "right" },
  })
  // Floating windows open in the dock's top-right corner.
  if (!beside && PANELS[component as PanelId]?.home === "float")
    floatAt(panel.group, Number.MAX_SAFE_INTEGER, 16)
  const edge = edgeOf(panel.group)
  if (edge) showEdge(dock, edge)
  return panel
}

const isLocked = (panel: IDockviewPanel) =>
  !!(panel.params as WindowParams | undefined)?.locked

/**
 * The tab of a following kind that tracks the selection: an unlocked one if
 * any, else a new one opened beside the locked ones.
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

/**
 * Shows a tab wherever it is: brings back its window or the tab itself,
 * re-opens it or un-hides its edge. Background reveals keep the focus.
 */
export function revealPanel(id: PanelId, { activate = true } = {}) {
  const dock = api()
  if (!dock) return
  const stowed = useDock.getState().stowed.find((item) => item.id === id)
  if (stowed) {
    restoreTab(stowed.id)
    return
  }
  const panel = PANELS[id].follows
    ? follower(id)
    : (dock.getPanel(id) ?? addWindow(id, id, PANELS[id].title))
  restoreGroup(panel.group)
  const edge = edgeOf(panel.group)
  if (edge) showEdge(dock, edge)
  if (activate) panel.api.setActive()
  syncDock()
}

/** Whether a window is in the layout rather than closed. */
export function useWindowShown(id: PanelId) {
  useDock((state) => state.revision)
  return !!useDock.getState().api?.getPanel(id)
}

/** The toolbar's edge toggles: show or hide everything docked there. */
export function toggleEdge(edge: Edge) {
  const dock = api()
  if (!dock) return
  const group = dock.getEdgeGroup(edge)
  const minimized =
    group && useDock.getState().minimized.some((m) => m.group === group.id)
  const visible = !!group && dock.isEdgeGroupVisible(edge) && !minimized
  if (visible) dock.setEdgeGroupVisible(edge, false)
  else if (group && dock.getGroup(group.id)?.panels.length) {
    restoreWindow(group.id)
    showEdge(dock, edge)
  } else {
    const home = (Object.keys(PANELS) as PanelId[]).find(
      (id) => PANELS[id].home === edge
    )
    if (home) revealPanel(home)
  }
  syncDock()
}

/* Tabs: lock and close act on one tab. */

/** Current targets of following tabs, for locking them in place. */
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

export function canLock(panel: IDockviewPanel) {
  return !!PANELS[panel.view.contentComponent as PanelId]?.follows
}

export function toggleLock(panel: IDockviewPanel) {
  const locked = isLocked(panel) ? undefined : lockTargets.get(panel.id)?.()
  panel.api.updateParameters({ ...panel.params, locked })
  syncDock()
  saveLayout()
}

/**
 * Document-like tabs and the extra tabs a lock opened close for good;
 * built-in tabs wait in the tray, since nothing else brings them back.
 */
export function closeTab(panel: IDockviewPanel) {
  const component = panel.view.contentComponent
  const disposable =
    !!PANELS[component as PanelId]?.closable || panel.id !== component
  if (!disposable)
    useDock.setState((state) => ({
      stowed: [
        ...state.stowed,
        {
          id: panel.id,
          component,
          title: panel.title ?? panel.id,
          params: panel.params,
        },
      ],
    }))
  panel.api.close()
  syncDock()
  saveLayout()
}

export function restoreTab(id: string) {
  const item = useDock.getState().stowed.find((entry) => entry.id === id)
  if (!item || !api()) return
  useDock.setState((state) => ({
    stowed: state.stowed.filter((entry) => entry !== item),
  }))
  const panel = addWindow(item.id, item.component, item.title, item.params)
  panel.api.setActive()
  syncDock()
  saveLayout()
}

/* Windows: the ··· capsule acts on the whole tab group. */

export function closeWindow(group: DockviewGroupPanel) {
  for (const panel of [...group.panels]) closeTab(panel)
}

function floatingBox(group: DockviewGroupPanel) {
  return group.element.closest<HTMLElement>(".dv-resize-container")
}

function hideGroup(group: DockviewGroupPanel, hidden: boolean) {
  const dock = api()!
  const edge = edgeOf(group)
  if (edge) {
    if (hidden) dock.setEdgeGroupVisible(edge, false)
    else showEdge(dock, edge)
  } else if (isFloating(group)) {
    const box = floatingBox(group)
    if (box) box.hidden = hidden
  } else group.api.setVisible(!hidden)
}

/** Hides a window in place; the tray brings it back where it was. */
export function minimizeWindow(group: DockviewGroupPanel) {
  if (useDock.getState().maximized === group.id) toggleMaximized(group)
  hideGroup(group, true)
  useDock.setState((state) => ({
    minimized: [
      ...state.minimized,
      { group: group.id, panels: group.panels.map((panel) => panel.id) },
    ],
  }))
  syncDock()
  saveLayout()
}

function restoreGroup(group: DockviewGroupPanel) {
  if (!useDock.getState().minimized.some((m) => m.group === group.id)) return
  useDock.setState((state) => ({
    minimized: state.minimized.filter((m) => m.group !== group.id),
  }))
  hideGroup(group, false)
}

export function restoreWindow(groupId: string) {
  const group = api()?.getGroup(groupId) as DockviewGroupPanel | undefined
  if (!group) return
  restoreGroup(group)
  group.activePanel?.api.setActive()
  syncDock()
  saveLayout()
}

/** Keeps the maximized window over the whole workbench as it resizes. */
function placeMaximized() {
  const id = useDock.getState().maximized
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-window-maximized]"
  ))
    if (element.dataset.windowMaximized !== id) {
      delete element.dataset.windowMaximized
      element.style.removeProperty("inset")
      element.style.removeProperty("width")
      element.style.removeProperty("height")
    }
  const group = id && (api()?.getGroup(id) as DockviewGroupPanel | undefined)
  const box = root()?.getBoundingClientRect()
  if (!group || !box) return
  const element = group.element
  element.dataset.windowMaximized = id
  element.style.inset = `${box.top}px auto auto ${box.left}px`
  element.style.width = `${box.width}px`
  element.style.height = `${box.height}px`
}

/** Fills the whole workbench with a window, or puts it back. */
export function toggleMaximized(group: DockviewGroupPanel) {
  useDock.setState((state) => ({
    maximized: state.maximized === group.id ? undefined : group.id,
  }))
  placeMaximized()
  group.activePanel?.api.setActive()
}

if (typeof window !== "undefined")
  window.addEventListener("resize", () => placeMaximized())

/* Floating: dragging a window's ··· pill lifts it out of the layout. */

const FLOAT_SIZE = { width: 480, height: 360 }

function floatAt(
  group: DockviewGroupPanel,
  left: number,
  top: number,
  size = FLOAT_SIZE,
  panel?: IDockviewPanel
) {
  const dock = api()
  if (!dock) return
  const box = root()?.getBoundingClientRect()
  const maxLeft = (box?.width ?? window.innerWidth) - size.width - 16
  const maxTop = (box?.height ?? window.innerHeight) - size.height - 16
  const position = {
    left: Math.max(0, Math.min(left, maxLeft)),
    top: Math.max(0, Math.min(top, maxTop)),
  }
  const floating = isFloating(group) && floatingBox(group)
  if (floating) {
    floating.style.left = `${position.left}px`
    floating.style.top = `${position.top}px`
  } else dock.addFloatingGroup(panel ?? group, { position, ...size })
}

export type DropTarget =
  | { kind: "group"; group: DockviewGroupPanel; position: DropPosition }
  | { kind: "edge"; edge: Edge }
export type DropPosition = "center" | "left" | "right" | "top" | "bottom"

/** How close to a window's border a drop splits it. */
const SPLIT_BAND = 48
/** How close to the workbench's border a drop docks to that edge. */
const EDGE_BAND = 24

/**
 * Where a window dragged to a point would dock, if anywhere. Only a
 * window's header (join its tabs) and the bands along its borders (split)
 * dock; everywhere else the window stays floating.
 */
export function dropTargetAt(
  x: number,
  y: number,
  dragged: DockviewGroupPanel
): DropTarget | undefined {
  const dock = api()
  const box = root()?.getBoundingClientRect()
  if (!dock || !box) return
  if (x - box.left < EDGE_BAND) return { kind: "edge", edge: "left" }
  if (box.right - x < EDGE_BAND) return { kind: "edge", edge: "right" }
  if (box.bottom - y < EDGE_BAND) return { kind: "edge", edge: "bottom" }
  for (const group of dock.groups) {
    if (group === dragged || isFloating(group)) continue
    if (useDock.getState().minimized.some((m) => m.group === group.id)) continue
    const rect = group.element.getBoundingClientRect()
    if (!rect.width || !rect.height) continue
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom)
      continue
    const header =
      group.element
        .querySelector(".dv-tabs-and-actions-container")
        ?.getBoundingClientRect().height ?? 40
    if (y - rect.top < header)
      return { kind: "group", group, position: "center" }
    const sides: [DropPosition, number][] = [
      ["left", x - rect.left],
      ["right", rect.right - x],
      ["top", y - rect.top - header],
      ["bottom", rect.bottom - y],
    ]
    const [side, distance] = sides.sort((a, b) => a[1] - b[1])[0]
    return distance < SPLIT_BAND
      ? { kind: "group", group, position: side }
      : undefined
  }
}

/** The area a drop target would take, in viewport pixels. */
export function dropPreview(target: DropTarget) {
  const dock = api()
  const box = root()?.getBoundingClientRect()
  if (!dock || !box) return
  if (target.kind === "edge") {
    const width = Math.min(320, box.width / 3)
    const height = Math.min(240, box.height / 3)
    if (target.edge === "left")
      return { left: box.left, top: box.top, width, height: box.height }
    if (target.edge === "right")
      return {
        left: box.right - width,
        top: box.top,
        width,
        height: box.height,
      }
    return {
      left: box.left,
      top: box.bottom - height,
      width: box.width,
      height,
    }
  }
  const rect = target.group.element.getBoundingClientRect()
  const half = { width: rect.width / 2, height: rect.height / 2 }
  switch (target.position) {
    case "left":
      return {
        left: rect.left,
        top: rect.top,
        width: half.width,
        height: rect.height,
      }
    case "right":
      return {
        left: rect.left + half.width,
        top: rect.top,
        width: half.width,
        height: rect.height,
      }
    case "top":
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: half.height,
      }
    case "bottom":
      return {
        left: rect.left,
        top: rect.top + half.height,
        width: rect.width,
        height: half.height,
      }
    default:
      return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      }
  }
}

/**
 * Lifts a docked window so it follows the pointer, returning the floating
 * window. Edge windows cannot float whole, so their tabs move out instead.
 */
export function liftWindow(group: DockviewGroupPanel, x: number, y: number) {
  const dock = api()
  if (!dock) return group
  if (useDock.getState().maximized === group.id) toggleMaximized(group)
  const box = root()?.getBoundingClientRect()
  const rect = group.element.getBoundingClientRect()
  const size = {
    width: Math.min(Math.max(rect.width, 320), 640),
    height: Math.min(Math.max(rect.height, 240), 480),
  }
  const left = x - (box?.left ?? 0) - 24
  const top = y - (box?.top ?? 0) - 16
  let floating = group
  if (edgeOf(group)) {
    const [first, ...rest] = group.panels
    const active = group.activePanel
    if (!first) return group
    floatAt(first.group, left, top, size, first)
    floating = first.group
    for (const panel of rest) panel.api.moveTo({ group: floating })
    active?.api.setActive()
  } else floatAt(group, left, top, size)
  syncDock()
  return floating
}

/** Moves a floating window so the pill stays under the pointer. */
export function moveFloating(group: DockviewGroupPanel, x: number, y: number) {
  const box = root()?.getBoundingClientRect()
  const size = floatingBox(group)?.getBoundingClientRect()
  floatAt(
    group,
    x - (box?.left ?? 0) - 24,
    y - (box?.top ?? 0) - 16,
    size ? { width: size.width, height: size.height } : FLOAT_SIZE
  )
}

/** Docks a dragged window where it was released. */
export function dockWindow(group: DockviewGroupPanel, target: DropTarget) {
  const dock = api()
  if (!dock) return
  if (target.kind === "edge") {
    const edge = dock.getEdgeGroup(target.edge)
    const edgeGroup = edge && (dock.getGroup(edge.id) as DockviewGroupPanel)
    if (!edgeGroup) return
    group.api.moveTo({ group: edgeGroup, position: "center" })
    showEdge(dock, target.edge)
  } else group.api.moveTo({ group: target.group, position: target.position })
  syncDock()
  saveLayout()
}

/* Persistence */

export function saveLayout() {
  const dock = api()
  if (!dock) return
  try {
    const saved: SavedLayout = {
      version: LAYOUT_VERSION,
      layout: dock.toJSON(),
      minimized: useDock.getState().minimized,
      stowed: useDock.getState().stowed,
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
          stowed: saved.stowed.filter(
            (item) => item.component in PANELS && !dock.getPanel(item.id)
          ),
          minimized: [],
        })
        for (const item of saved.minimized) {
          const group = dock.getGroup(item.group) as
            DockviewGroupPanel | undefined
          if (group) minimizeWindow(group)
        }
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
 * Every built-in tab stays reachable: one missing from both the layout and
 * the tray (an older or damaged layout) returns home.
 */
function ensureWindows(dock: DockviewApi) {
  const stowed = useDock.getState().stowed
  for (const id of Object.keys(PANELS) as PanelId[]) {
    if (PANELS[id].closable) continue
    const present =
      dock.panels.some((panel) => panel.view.contentComponent === id) ||
      stowed.some((item) => item.component === id)
    if (present) continue
    const panel = addWindow(id, id, PANELS[id].title)
    const edge = edgeOf(panel.group)
    if (edge === "bottom") dock.setEdgeGroupVisible(edge, false)
  }
}

export function applyPreset(preset: PresetId) {
  const dock = api()
  if (!dock) return
  useDock.setState({ maximized: undefined, minimized: [], stowed: [] })
  placeMaximized()
  dock.clear()
  buildPreset(dock, preset)
  syncDock()
  saveLayout()
}
