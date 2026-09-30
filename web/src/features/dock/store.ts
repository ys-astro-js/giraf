import { create } from "zustand"
import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
} from "dockview-react"
import { PANELS, type PanelId } from "./panels"
import { buildPreset, type PresetId } from "./presets"
import { recordBars } from "./morph"

/** A side of the workbench; its toolbar toggle hides the windows along it. */
export type Edge = "left" | "right" | "bottom"
export const EDGES: Edge[] = ["left", "right", "bottom"]
const OPPOSITE: Record<Edge, "left" | "right" | "top"> = {
  left: "right",
  right: "left",
  bottom: "top",
}

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
  /** Sides whose windows are shown. */
  edges: Record<Edge, boolean>
  /** Sides holding windows, shown or not: only these get a toolbar toggle. */
  docked: Record<Edge, boolean>
  /** Windows a side's toggle hid, to bring back together. */
  hidden: Record<Edge, string[]>
  minimized: MinimizedWindow[]
  stowed: StowedTab[]
  /** The window filling the whole workbench, if any. */
  maximized?: string
  /**
   * The window that is the whole workbench: the maximized one, or the only
   * one shown. It runs under the app's top bar, which takes its bar's look.
   */
  fullscreen?: string
  /** Bumped on every structural change so window chrome re-reads it. */
  revision: number
}

export const useDock = create<DockState>()(() => ({
  edges: { left: false, right: false, bottom: false },
  docked: { left: false, right: false, bottom: false },
  hidden: { left: [], right: [], bottom: [] },
  minimized: [],
  stowed: [],
  revision: 0,
}))

const LAYOUT_KEY = "giraf-dock-layout"
const LAYOUT_VERSION = 3
type SavedLayout = {
  version: number
  layout: unknown
  hidden: Record<Edge, string[]>
  minimized: MinimizedWindow[]
  stowed: StowedTab[]
}

const api = () => useDock.getState().api
const root = () => document.querySelector(".dock-root")

export const isFloating = (group: DockviewGroupPanel) =>
  group.api.location.type === "floating"

const isMain = (group: DockviewGroupPanel) =>
  group.panels.some((panel) => panel.id === "workflow")

/**
 * The shown windows along a side: they touch it but not the side across,
 * so windows spanning the workbench and the workflow's window stay put.
 */
function sideWindows(dock: DockviewApi, edge: Edge) {
  const box = root()?.getBoundingClientRect()
  if (!box) return []
  const touches = (rect: DOMRect, side: Edge | "top") =>
    Math.abs(rect[side] - box[side]) < 2
  return dock.groups.filter((group) => {
    if (group.api.location.type !== "grid" || isMain(group)) return false
    const rect = group.element.getBoundingClientRect()
    if (!rect.width || !rect.height) return false
    return touches(rect, edge) && !touches(rect, OPPOSITE[edge])
  })
}

/** Every window keeps its header row on top. */
function syncHeaders(dock: DockviewApi) {
  for (const group of dock.groups) {
    if (group.api.getHeaderPosition() !== "top")
      group.api.setHeaderPosition("top")
    group.model.header.hidden = false
  }
}

/** Re-reads the layout facts the rest of the app shows. */
export function syncDock() {
  const dock = api()
  if (!dock) return
  syncHeaders(dock)
  const groups = new Set(dock.groups.map((group) => group.id))
  useDock.setState((state) => {
    const hidden = Object.fromEntries(
      EDGES.map((edge) => [
        edge,
        state.hidden[edge].filter((id) => groups.has(id)),
      ])
    ) as Record<Edge, string[]>
    const shown = Object.fromEntries(
      EDGES.map((edge) => [edge, sideWindows(dock, edge).length > 0])
    ) as Record<Edge, boolean>
    return {
      hidden,
      edges: Object.fromEntries(
        EDGES.map((edge) => [edge, shown[edge] && !hidden[edge].length])
      ) as Record<Edge, boolean>,
      docked: Object.fromEntries(
        EDGES.map((edge) => [edge, shown[edge] || hidden[edge].length > 0])
      ) as Record<Edge, boolean>,
      // A window whose tabs all moved away is no longer minimized.
      minimized: state.minimized.filter((item) => groups.has(item.group)),
      maximized: maximizedWindow(dock, state.maximized),
      revision: state.revision + 1,
    }
  })
  markFullscreen(dock)
}

/** The maximized window: dockview's for docked windows, ours for floating. */
function maximizedWindow(dock: DockviewApi, current?: string) {
  const docked = dock.groups.find(
    (group) => group.api.location.type === "grid" && group.api.isMaximized()
  )
  if (docked) return docked.id
  const floating = current && dock.getGroup(current)
  return floating && isFloating(floating as DockviewGroupPanel)
    ? current
    : undefined
}

/**
 * Marks the window that is the whole workbench (see DockState.fullscreen)
 * on its element, where the app's bars read it.
 */
function markFullscreen(dock: DockviewApi) {
  const { maximized, minimized } = useDock.getState()
  // Read from the layout, not the page: mid-change, sizes lag behind.
  const shown = dock.groups.filter((group) => {
    if (minimized.some((item) => item.group === group.id)) return false
    if (!group.panels.length) return false
    return isFloating(group) ? !floatingBox(group)?.hidden : group.api.isVisible
  })
  const id = maximized ?? (shown.length === 1 ? shown[0].id : undefined)
  for (const group of dock.groups)
    if (group.id === id) group.element.dataset.fullscreen = ""
    else delete group.element.dataset.fullscreen
  if (useDock.getState().fullscreen !== id) useDock.setState({ fullscreen: id })
}

const SIDE_SIZE: Record<Edge, number> = { left: 256, right: 384, bottom: 240 }

const homeOf = (component: string) =>
  PANELS[component as PanelId]?.home ?? "center"

/** Sizes a window that just joined a side of the workbench. */
function sizeForSide(group: DockviewGroupPanel, edge: Edge) {
  group.api.setSize(
    edge === "bottom"
      ? { height: SIDE_SIZE.bottom }
      : { width: SIDE_SIZE[edge] }
  )
}

/** A docked window already holding tabs that share a home side. */
function homeGroup(component: string) {
  const home = homeOf(component)
  if (home === "center" || home === "float") return
  return api()?.groups.find(
    (group) =>
      group.api.location.type === "grid" &&
      group.panels.some((panel) => homeOf(panel.view.contentComponent) === home)
  )
}

function addWindow(
  id: string,
  component: string,
  title: string,
  params: Record<string, unknown> = {},
  beside?: DockviewGroupPanel
) {
  const dock = api()!
  const home = homeOf(component)
  const joined = beside ?? homeGroup(component)
  const workflow = dock.getPanel("workflow")
  const grid = dock.groups.find((group) => group.api.location.type === "grid")
  const side = home === "center" || home === "float" ? undefined : home
  const panel = dock.addPanel({
    id,
    component,
    title,
    params,
    position: joined
      ? { referenceGroup: joined }
      : side === "bottom" && workflow
        ? { referencePanel: workflow, direction: "below" }
        : side
          ? { direction: side }
          : workflow
            ? { referencePanel: workflow, direction: "right" }
            : grid
              ? { referenceGroup: grid, direction: "right" }
              : { direction: "right" },
    ...(side && !joined
      ? side === "bottom"
        ? { initialHeight: SIDE_SIZE.bottom }
        : { initialWidth: SIDE_SIZE[side] }
      : {}),
  })
  if (joined) restoreGroup(joined)
  // Floating windows open in the dock's top-right corner.
  if (!beside && home === "float")
    floatAt(panel.group, Number.MAX_SAFE_INTEGER, 16)
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
  if (activate && panel.group.activePanel !== panel) recordBars(panel.group)
  if (activate) panel.api.setActive()
  syncDock()
}

/** Whether a window is in the layout rather than closed. */
export function useWindowShown(id: PanelId) {
  useDock((state) => state.revision)
  return !!useDock.getState().api?.getPanel(id)
}

/** Hides the windows along a side until its toggle brings them back. */
export function hideSide(edge: Edge, groups = sideWindows(api()!, edge)) {
  for (const group of groups) group.api.setVisible(false)
  useDock.setState((state) => ({
    hidden: {
      ...state.hidden,
      [edge]: [...state.hidden[edge], ...groups.map((group) => group.id)],
    },
  }))
}

/** The toolbar's side toggles: hide or show the windows along a side. */
export function toggleEdge(edge: Edge) {
  const dock = api()
  if (!dock) return
  const hidden = useDock.getState().hidden[edge]
  const shown = sideWindows(dock, edge)
  if (hidden.length) {
    useDock.setState((state) => ({
      hidden: { ...state.hidden, [edge]: [] },
    }))
    // Shown in reverse of hiding, windows that share a side keep their sizes.
    for (const id of [...hidden].reverse()) {
      const group = dock.getGroup(id) as DockviewGroupPanel | undefined
      if (group) restoreGroup(group, true)
    }
  } else if (shown.length) hideSide(edge, shown)
  else {
    const home = (Object.keys(PANELS) as PanelId[]).find(
      (id) => PANELS[id].home === edge
    )
    if (home) revealPanel(home)
  }
  syncDock()
  saveLayout()
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

/**
 * Floating windows are placed relative to the central grid, not the whole
 * workbench; every floating position is measured from here.
 */
function floatHost() {
  const element =
    document.querySelector(".dv-floating-overlay-host") ??
    document.querySelector(".dv-shell-middle-column") ??
    root()
  return element?.getBoundingClientRect() ?? new DOMRect()
}

function floatingBox(group: DockviewGroupPanel) {
  return group.element.closest<HTMLElement>(".dv-resize-container")
}

function hideGroup(group: DockviewGroupPanel, hidden: boolean) {
  if (isFloating(group)) {
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

/** Shows a window that was minimized or hidden with its side. */
function restoreGroup(group: DockviewGroupPanel, force = false) {
  const state = useDock.getState()
  const minimized = state.minimized.some((m) => m.group === group.id)
  const sided = EDGES.some((edge) => state.hidden[edge].includes(group.id))
  if (!minimized && !sided && !force) return
  useDock.setState((state) => ({
    minimized: state.minimized.filter((m) => m.group !== group.id),
    hidden: Object.fromEntries(
      EDGES.map((edge) => [
        edge,
        state.hidden[edge].filter((id) => id !== group.id),
      ])
    ) as Record<Edge, string[]>,
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

/** Where a floating window was before it was maximized. */
const floatingBefore = new Map<
  string,
  { left: string; top: string; width: number; height: number }
>()

/**
 * Fills the whole workbench with a window, or puts it back. Docked windows
 * use dockview's own maximize, which lays their contents out; a floating
 * window grows over the workbench and returns to where it was.
 */
export function toggleMaximized(group: DockviewGroupPanel) {
  const dock = api()
  if (!dock) return
  if (!isFloating(group)) {
    if (group.api.isMaximized()) group.api.exitMaximized()
    else group.api.maximize()
    syncDock()
    group.activePanel?.api.setActive()
    return
  }
  const box = floatingBox(group)
  if (!box) return
  const before = floatingBefore.get(group.id)
  if (useDock.getState().maximized === group.id && before) {
    floatingBefore.delete(group.id)
    box.style.left = before.left
    box.style.top = before.top
    group.api.setSize({ width: before.width, height: before.height })
    useDock.setState({ maximized: undefined })
  } else {
    const rect = box.getBoundingClientRect()
    floatingBefore.set(group.id, {
      left: box.style.left,
      top: box.style.top,
      width: rect.width,
      height: rect.height,
    })
    const host = floatHost()
    const bounds = root()?.getBoundingClientRect() ?? host
    box.style.left = `${bounds.left - host.left}px`
    box.style.top = `${bounds.top - host.top}px`
    group.api.setSize({ width: bounds.width, height: bounds.height })
    useDock.setState({ maximized: group.id })
  }
  syncDock()
  group.activePanel?.api.setActive()
}

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
  // Keep the window inside the workbench, in the float host's coordinates.
  const host = floatHost()
  const bounds = root()?.getBoundingClientRect() ?? host
  const minLeft = bounds.left - host.left
  const minTop = bounds.top - host.top
  const maxLeft = bounds.right - host.left - size.width - 16
  const maxTop = bounds.bottom - host.top - size.height - 16
  const position = {
    left: Math.max(minLeft, Math.min(left, maxLeft)),
    top: Math.max(minTop, Math.min(top, maxTop)),
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
/** How close to the workbench's border a drop docks along that whole side. */
const EDGE_BAND = 24

/**
 * The window drawn topmost at a point, other than the one being dragged:
 * floating windows cover docked ones, and later-focused floats the rest.
 */
function windowAt(x: number, y: number, dragged: DockviewGroupPanel) {
  const dock = api()
  if (!dock) return
  for (const element of document.elementsFromPoint(x, y)) {
    if (dragged.element.contains(element)) continue
    const group = dock.groups.find((g) => g.element.contains(element))
    if (group) return group
  }
}

/**
 * Where a window dragged to a point would dock, if anywhere. Only a
 * window's header (join its tabs) and the bands along its borders (split)
 * dock; everywhere else the window stays floating. A floating window only
 * takes tabs: it holds a single group and cannot split.
 */
export function dropTargetAt(
  x: number,
  y: number,
  dragged: DockviewGroupPanel
): DropTarget | undefined {
  const dock = api()
  const box = root()?.getBoundingClientRect()
  if (!dock || !box) return
  const group = windowAt(x, y, dragged)
  const floating = group && isFloating(group)
  if (!floating) {
    if (x - box.left < EDGE_BAND) return { kind: "edge", edge: "left" }
    if (box.right - x < EDGE_BAND) return { kind: "edge", edge: "right" }
    if (box.bottom - y < EDGE_BAND) return { kind: "edge", edge: "bottom" }
  }
  if (!group) return
  if (useDock.getState().minimized.some((m) => m.group === group.id)) return
  const rect = group.element.getBoundingClientRect()
  const header =
    group.element
      .querySelector(".dv-tabs-and-actions-container")
      ?.getBoundingClientRect().height ?? 40
  if (y - rect.top < header) return { kind: "group", group, position: "center" }
  if (floating) return
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

/** Where the pointer holds a moving window, from its top-left corner. */
export type Grip = { window: DockviewGroupPanel; dx: number; dy: number }

function floatingSize(rect: DOMRect) {
  return {
    width: Math.min(Math.max(rect.width, 320), 640),
    height: Math.min(Math.max(rect.height, 240), 480),
  }
}

/**
 * Lifts a docked window so it follows the pointer, keeping the spot the
 * pointer grabbed. Edge windows cannot float whole, so their tabs move out.
 */
export function liftWindow(
  group: DockviewGroupPanel,
  x: number,
  y: number
): Grip {
  const dock = api()
  if (useDock.getState().maximized === group.id) toggleMaximized(group)
  const rect = group.element.getBoundingClientRect()
  if (!dock) return { window: group, dx: x - rect.left, dy: y - rect.top }
  const size = floatingSize(rect)
  // The grabbed point keeps its share of the width as the window shrinks.
  const dx = Math.min(
    ((x - rect.left) / Math.max(rect.width, 1)) * size.width,
    size.width - 16
  )
  const dy = Math.min(y - rect.top, 32)
  const box = floatHost()
  const left = x - (box?.left ?? 0) - dx
  const top = y - (box?.top ?? 0) - dy
  floatAt(group, left, top, size)
  syncDock()
  return { window: group, dx, dy }
}

/** Pulls one tab out of its window into a floating window of its own. */
export function liftTab(panel: IDockviewPanel, x: number, y: number): Grip {
  const size = floatingSize(panel.group.element.getBoundingClientRect())
  const dx = 64
  const dy = 20
  const box = floatHost()
  floatAt(
    panel.group,
    x - (box?.left ?? 0) - dx,
    y - (box?.top ?? 0) - dy,
    size,
    panel
  )
  panel.api.setActive()
  syncDock()
  return { window: panel.group, dx, dy }
}

/** A floating window already under the pointer keeps where it was held. */
export function holdFloating(
  group: DockviewGroupPanel,
  x: number,
  y: number
): Grip {
  const rect = (floatingBox(group) ?? group.element).getBoundingClientRect()
  return { window: group, dx: x - rect.left, dy: y - rect.top }
}

/** Moves a floating window so the grabbed spot stays under the pointer. */
export function moveFloating(grip: Grip, x: number, y: number) {
  const box = floatHost()
  const size = floatingBox(grip.window)?.getBoundingClientRect()
  floatAt(
    grip.window,
    x - (box?.left ?? 0) - grip.dx,
    y - (box?.top ?? 0) - grip.dy,
    size ? { width: size.width, height: size.height } : FLOAT_SIZE
  )
}

/** Docks a dragged window where it was released. */
export function dockWindow(group: DockviewGroupPanel, target: DropTarget) {
  const dock = api()
  if (!dock) return
  if (target.kind === "edge") {
    // Without a group, dockview adds one along the whole side.
    const panel = group.activePanel
    group.api.moveTo({ position: target.edge })
    if (panel) sizeForSide(panel.group, target.edge)
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
      hidden: useDock.getState().hidden,
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
          hidden: saved.hidden,
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
    if (PANELS[id].home === "bottom") hideSide("bottom", [panel.group])
  }
}

export function applyPreset(preset: PresetId) {
  const dock = api()
  if (!dock) return
  useDock.setState({
    maximized: undefined,
    minimized: [],
    stowed: [],
    hidden: { left: [], right: [], bottom: [] },
  })
  if (dock.hasMaximizedGroup()) dock.exitMaximizedGroup()
  dock.clear()
  buildPreset(dock, preset)
  syncDock()
  saveLayout()
}
