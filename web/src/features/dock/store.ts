import { create } from "zustand"
import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
} from "dockview-react"
import { PANELS, type PanelId } from "./panels"
import { buildPreset, type PresetId } from "./presets"
import { recordBars } from "./morph"
import { animateLayout, quietly } from "./transition"
import {
  EDGES,
  emptySnaps,
  readSnaps,
  regionOf,
  resized,
  setHidden,
  sidesBeside,
  snap,
  snapBoxes,
  unsnap,
  type Box,
  type Edge,
  type Region,
  type Side,
  type Snaps,
} from "./layout"

/*
 * The workbench is a desktop. Every window is a free window over it (a
 * dockview floating group); snapping one to an edge, or into the space the
 * edges leave, gives it a box from the snap model (layout.ts). Windows
 * never move on their own: a window leaving its place leaves desktop there.
 * Only snapping, a side's toggle and the workbench resizing lay the snapped
 * windows out again.
 */

export { EDGES }
export type { Edge, Region, Side }

/** What a locked tab keeps showing instead of following the selection. */
export type WindowParams = { locked?: string }

/** A minimized window: hidden in place until the tray brings it back. */
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
  snaps: Snaps
  /** Sides whose windows are shown. */
  edges: Record<Edge, boolean>
  /** Sides holding windows, shown or not: only these get a toolbar toggle. */
  docked: Record<Edge, boolean>
  minimized: MinimizedWindow[]
  stowed: StowedTab[]
  /**
   * The window filling the whole workbench (fullscreen), if any. It runs
   * under the app's top bar and moves its own top bar controls into it.
   */
  maximized?: string
  /** Bumped on every structural change so window chrome re-reads it. */
  revision: number
}

const noEdges = () => ({ left: false, right: false, bottom: false })

export const useDock = create<DockState>()(() => ({
  snaps: emptySnaps(),
  edges: noEdges(),
  docked: noEdges(),
  minimized: [],
  stowed: [],
  revision: 0,
}))

const LAYOUT_KEY = "giraf-dock-layout"
const LAYOUT_VERSION = 5
type SavedLayout = {
  version: number
  layout: unknown
  snaps: unknown
  minimized: MinimizedWindow[]
  stowed: StowedTab[]
  places?: Record<string, Place>
}

const api = () => useDock.getState().api
const snaps = () => useDock.getState().snaps

/** The workbench element every window lies within. */
export const dockRoot = () => document.querySelector(".dock-root")

/** Whether a window is snapped (has a place in the snap model). */
export const isSnapped = (group: DockviewGroupPanel) =>
  !!regionOf(snaps(), group.id)

/** The sides a snapped window can take another window beside it. */
export const sidesOf = (group: DockviewGroupPanel) =>
  sidesBeside(snaps(), group.id)

/**
 * Floating windows are placed relative to dockview's overlay host, not the
 * workbench; every position is measured from here.
 */
function floatHost() {
  const element =
    document.querySelector(".dv-floating-overlay-host") ??
    document.querySelector(".dv-shell-middle-column") ??
    dockRoot()
  return element?.getBoundingClientRect() ?? new DOMRect()
}

function floatingBox(group: DockviewGroupPanel) {
  return group.element.closest<HTMLElement>(".dv-resize-container")
}

/** The workbench's size, which the snap model lays windows out in. */
function workbench() {
  const rect = dockRoot()?.getBoundingClientRect()
  return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
}

/** A window's box in workbench coordinates. */
function boxOf(group: DockviewGroupPanel): Box | undefined {
  const rect = floatingBox(group)?.getBoundingClientRect()
  const root = dockRoot()?.getBoundingClientRect()
  if (!rect || !root) return
  return {
    left: rect.left - root.left,
    top: rect.top - root.top,
    width: rect.width,
    height: rect.height,
  }
}

/** Puts a window at a box given in workbench coordinates. */
function place(group: DockviewGroupPanel, box: Box) {
  const element = floatingBox(group)
  if (!element) return
  const host = floatHost()
  const root = dockRoot()?.getBoundingClientRect() ?? host
  element.style.left = `${root.left - host.left + box.left}px`
  element.style.top = `${root.top - host.top + box.top}px`
  group.api.setSize({ width: box.width, height: box.height })
}

function minimizedIds() {
  return new Set(useDock.getState().minimized.map((item) => item.group))
}

/**
 * The boxes snapped windows take. Every snapped window has the same border
 * on all four sides; a window that has a neighbor to its right or below
 * reaches one pixel into it, so the two borders lie on one line.
 */
function tiles(model: Snaps, size = workbench()) {
  const boxes = snapBoxes(model, size)
  for (const [id, box] of boxes)
    boxes.set(id, {
      ...box,
      width: box.width + (box.left + box.width < size.width - 0.5 ? 1 : 0),
      height: box.height + (box.top + box.height < size.height - 0.5 ? 1 : 0),
    })
  return boxes
}

/**
 * Lays the snapped windows out by the model, and hides the windows of a
 * side its toggle hid. Minimized windows stay hidden.
 */
function layOut() {
  const dock = api()
  if (!dock || useDock.getState().maximized) return
  const model = snaps()
  const boxes = tiles(model)
  const minimized = minimizedIds()
  for (const group of dock.groups) {
    const element = floatingBox(group)
    const region = regionOf(model, group.id)
    if (!element) continue
    if (region) element.dataset.snapped = region
    else delete element.dataset.snapped
    if (!region) continue
    const box = boxes.get(group.id)
    element.hidden = !box || minimized.has(group.id)
    if (!box) continue
    place(group, box)
  }
}

/** Changes the snap model and lays the windows out again, animated. */
function arrange(change: (model: Snaps) => Snaps) {
  animateLayout(api(), () => {
    useDock.setState({ snaps: change(snaps()) })
    layOut()
    syncDock()
  })
  saveLayout()
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
    // Windows that closed or merged leave the model; nothing else moves.
    let model = state.snaps
    for (const region of ["left", "right", "bottom", "center"] as Region[])
      for (const id of model.regions[region])
        if (!groups.has(id)) model = unsnap(model, id)
    const docked = Object.fromEntries(
      EDGES.map((edge) => [edge, model.regions[edge].length > 0])
    ) as Record<Edge, boolean>
    return {
      snaps: model,
      docked,
      edges: Object.fromEntries(
        EDGES.map((edge) => [edge, docked[edge] && !model.hidden[edge]])
      ) as Record<Edge, boolean>,
      minimized: state.minimized.filter((item) => groups.has(item.group)),
      maximized:
        state.maximized && groups.has(state.maximized)
          ? state.maximized
          : undefined,
      revision: state.revision + 1,
    }
  })
  markWindows(dock)
}

/**
 * Marks layout facts on each window's element for its bars' styles:
 * `data-tabbed` while it holds several tabs (a tab bar, translucent top bar),
 * `data-fullscreen` while it fills the workbench.
 */
function markWindows(dock: DockviewApi) {
  const maximized = useDock.getState().maximized
  for (const group of dock.groups) {
    mark(group.element, "tabbed", group.panels.length > 1)
    mark(group.element, "fullscreen", group.id === maximized)
  }
}

function mark(element: HTMLElement, name: string, on: boolean) {
  if (on) element.dataset[name] = ""
  else delete element.dataset[name]
}

/** The workbench size the snapped windows were last laid out in. */
let laidOut = { width: 0, height: 0 }

/** Lays the snapped windows out again when the workbench resized. */
export function followLayout() {
  const size = workbench()
  if (size.width === laidOut.width && size.height === laidOut.height) return
  laidOut = size
  layOut()
}

/**
 * Follows the user resizing a snapped window by an edge: its side's size
 * or its share of its region follows, and the snapped windows around it
 * make room.
 */
export function followResize(group: DockviewGroupPanel) {
  const box = boxOf(group)
  if (!box || !isSnapped(group)) return
  useDock.setState({ snaps: resized(snaps(), group.id, box, workbench()) })
  layOut()
}

/* Opening windows: a window opens where it was when it closed, else it
   floats. No window has a place of its own by its role. */

const FLOAT_SIZE = { width: 480, height: 360 }

/** Where a window was when it closed: its snapped region, or its box. */
type Place = { region?: Region; box?: Box }

let places: Record<string, Place> = {}

/** Remembers where a window is, as it closes. */
function rememberPlace(panel: IDockviewPanel) {
  const region = regionOf(snaps(), panel.group.id)
  const box = region ? undefined : boxOf(panel.group)
  places[panel.id] = { region, box }
}

/** A new free window: in the middle of the workbench, cascading. */
function freshBox(): Box {
  const size = workbench()
  const step = 24 * ((api()?.groups.length ?? 0) % 6)
  return {
    left: (size.width - FLOAT_SIZE.width) / 2 + step,
    top: (size.height - FLOAT_SIZE.height) / 3 + step,
    ...FLOAT_SIZE,
  }
}

type NewPanel = {
  id: string
  component: string
  title: string
  params?: Record<string, unknown>
}

/** Opens panels together as one free window at a box (workbench coords). */
function openWindow(panels: NewPanel[], box: Box) {
  const dock = api()!
  const host = floatHost()
  const root = dockRoot()?.getBoundingClientRect() ?? host
  const [first, ...rest] = panels
  const panel = dock.addPanel({
    ...first,
    floating: {
      position: {
        left: root.left - host.left + box.left,
        top: root.top - host.top + box.top,
      },
      width: box.width,
      height: box.height,
    },
  })
  for (const item of rest)
    dock.addPanel({ ...item, position: { referenceGroup: panel.group } })
  panel.api.setActive()
  return panel.group
}

/** Opens a window where it last was, or as a tab of the window it joins. */
function addWindow(panel: NewPanel, beside?: DockviewGroupPanel) {
  const dock = api()!
  if (beside) {
    restoreGroup(beside)
    return dock.addPanel({ ...panel, position: { referenceGroup: beside } })
  }
  const where = places[panel.id] ?? {}
  delete places[panel.id]
  const group = openWindow([panel], where.box ?? freshBox())
  if (where.region) {
    useDock.setState({ snaps: snap(snaps(), group.id, where.region) })
    layOut()
  }
  return group.panels[0]
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
    {
      id: same.length ? `${component}-${n}` : component,
      component,
      title: PANELS[component].title,
    },
    same[0]?.group
  )
}

/**
 * Shows a tab wherever it is: brings back its window or the tab itself,
 * re-opens it or shows its side. Background reveals keep the focus.
 */
export function revealPanel(id: PanelId, { activate = true } = {}) {
  const dock = api()
  if (!dock) return
  if (useDock.getState().stowed.some((item) => item.id === id)) {
    restoreTab(id)
    return
  }
  animateLayout(dock, () => {
    const panel = PANELS[id].follows
      ? follower(id)
      : (dock.getPanel(id) ??
        addWindow({ id, component: id, title: PANELS[id].title }))
    restoreGroup(panel.group)
    const region = regionOf(snaps(), panel.group.id)
    if (region && region !== "center" && snaps().hidden[region]) {
      useDock.setState({ snaps: setHidden(snaps(), region, false) })
      layOut()
    }
    if (activate && panel.group.activePanel !== panel) recordBars(panel.group)
    if (activate) panel.api.setActive()
    syncDock()
  })
  saveLayout()
}

/** Whether a window is in the layout rather than closed. */
export function useWindowShown(id: PanelId) {
  useDock((state) => state.revision)
  return !!useDock.getState().api?.getPanel(id)
}

/**
 * The toolbar's side toggles: hide or show the windows snapped along a
 * side; the snapped windows beside them take up the space meanwhile.
 */
export function toggleEdge(edge: Edge) {
  if (!snaps().regions[edge].length) return
  arrange((model) => setHidden(model, edge, !model.hidden[edge]))
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

/** What closing a tab also ends, such as IRAF's display session. */
const closeActions = new Map<string, () => void>()
export function registerCloseAction(panelId: string, action: () => void) {
  closeActions.set(panelId, action)
  return () => {
    if (closeActions.get(panelId) === action) closeActions.delete(panelId)
  }
}

/**
 * Document-like tabs and the extra tabs a lock opened close for good;
 * built-in tabs wait in the tray, since nothing else brings them back.
 * Either way the windows around stay where they are.
 */
export function closeTab(panel: IDockviewPanel) {
  animateLayout(api(), () => {
    closeActions.get(panel.id)?.()
    rememberPlace(panel)
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
  })
  saveLayout()
}

export function restoreTab(id: string) {
  const item = useDock.getState().stowed.find((entry) => entry.id === id)
  if (!item || !api()) return
  animateLayout(api(), () => {
    useDock.setState((state) => ({
      stowed: state.stowed.filter((entry) => entry !== item),
    }))
    addWindow(item).api.setActive()
    syncDock()
  })
  saveLayout()
}

/* Windows: the window pill acts on the whole tab group. */

export function closeWindow(group: DockviewGroupPanel) {
  animateLayout(api(), () => {
    for (const panel of [...group.panels]) closeTab(panel)
  })
}

/** Hides a window in place; the tray brings it back where it was. */
export function minimizeWindow(group: DockviewGroupPanel) {
  animateLayout(api(), () => {
    if (useDock.getState().maximized === group.id) toggleMaximized(group)
    const box = floatingBox(group)
    if (box) box.hidden = true
    useDock.setState((state) => ({
      minimized: [
        ...state.minimized,
        { group: group.id, panels: group.panels.map((panel) => panel.id) },
      ],
    }))
    syncDock()
  })
  saveLayout()
}

/** Shows a window that was minimized. */
function restoreGroup(group: DockviewGroupPanel) {
  if (!useDock.getState().minimized.some((m) => m.group === group.id)) return
  useDock.setState((state) => ({
    minimized: state.minimized.filter((m) => m.group !== group.id),
  }))
  const box = floatingBox(group)
  if (box) box.hidden = false
}

export function restoreWindow(groupId: string) {
  const group = api()?.getGroup(groupId) as DockviewGroupPanel | undefined
  if (!group) return
  animateLayout(api(), () => {
    restoreGroup(group)
    group.activePanel?.api.setActive()
    syncDock()
  })
  saveLayout()
}

/** Where a free window was before it went fullscreen. */
const beforeFullscreen = new Map<string, Box>()

/**
 * Fills the whole workbench with a window, or puts it back: a free window
 * where it was, a snapped one in its place. Only the window's own button
 * does this.
 */
export function toggleMaximized(group: DockviewGroupPanel) {
  animateLayout(api(), () => {
    if (useDock.getState().maximized === group.id) {
      useDock.setState({ maximized: undefined })
      syncDock()
      const box = beforeFullscreen.get(group.id)
      beforeFullscreen.delete(group.id)
      if (isSnapped(group)) layOut()
      else if (box) place(group, box)
    } else {
      const box = boxOf(group)
      if (box) beforeFullscreen.set(group.id, box)
      // Fullscreen first: the workbench grows under the app's bar, and the
      // window takes the workbench as it then is.
      useDock.setState({ maximized: group.id })
      syncDock()
      place(group, { left: 0, top: 0, ...workbench() })
    }
    group.activePanel?.api.setActive()
  })
  saveLayout()
}

/* Moving: a window picked up floats under the pointer; released, it lands
   where the pointer says (see drag.ts), or stays free there. */

export type DropPosition = "center" | Side

export type DropTarget =
  /** Join another window as a tab. */
  | { kind: "merge"; group: DockviewGroupPanel }
  /** Snap into a region, at its end or beside a window there. */
  | { kind: "snap"; region: Region; beside?: { id: string; side: Side } }

/** The size a snapped window takes when it is picked up and floats. */
export function floatingSize(rect: DOMRect) {
  return {
    width: Math.min(Math.max(rect.width, 320), 640),
    height: Math.min(Math.max(rect.height, 240), 480),
  }
}

/** Where the pointer holds a moving window, from its top-left corner. */
export type Grip = {
  window: DockviewGroupPanel
  dx: number
  dy: number
  /** The snap model before the window was picked up, to put it back. */
  before?: Snaps
  /** Where the pointer picked it up, to put a free window back. */
  from: { x: number; y: number }
}

/** Moves a free window's top-left corner to a viewport point, inside the workbench. */
function moveTo(group: DockviewGroupPanel, left: number, top: number) {
  const element = floatingBox(group)
  const root = dockRoot()?.getBoundingClientRect()
  if (!element || !root) return
  const rect = element.getBoundingClientRect()
  const host = floatHost()
  const x = Math.max(root.left, Math.min(left, root.right - rect.width))
  const y = Math.max(root.top, Math.min(top, root.bottom - rect.height))
  element.style.left = `${x - host.left}px`
  element.style.top = `${y - host.top}px`
}

/**
 * Picks up a window under the pointer. A snapped one leaves the model
 * (nothing else moves) and takes a free window's size, keeping the spot
 * the pointer grabbed.
 */
export function liftWindow(
  group: DockviewGroupPanel,
  x: number,
  y: number
): Grip {
  const rect = (floatingBox(group) ?? group.element).getBoundingClientRect()
  const from = { x, y }
  if (!isSnapped(group))
    return { window: group, dx: x - rect.left, dy: y - rect.top, from }
  if (useDock.getState().maximized === group.id) toggleMaximized(group)
  const before = snaps()
  const size = floatingSize(rect)
  // The grabbed point keeps its share of the width as the window shrinks.
  const dx = Math.min(
    ((x - rect.left) / Math.max(rect.width, 1)) * size.width,
    size.width - 16
  )
  const dy = Math.min(y - rect.top, 32)
  quietly(() => {
    useDock.setState({ snaps: unsnap(before, group.id) })
    const element = floatingBox(group)
    if (element) delete element.dataset.snapped
    group.api.setSize(size)
    moveTo(group, x - dx, y - dy)
    syncDock()
  })
  return { window: group, dx, dy, before, from }
}

/** Pulls one tab out of its window into a free window of its own. */
export function liftTab(panel: IDockviewPanel, x: number, y: number): Grip {
  const size = floatingSize(panel.group.element.getBoundingClientRect())
  const dx = 64
  const dy = 20
  const host = floatHost()
  quietly(() => {
    api()?.addFloatingGroup(panel, {
      position: { left: x - dx - host.left, top: y - dy - host.top },
      ...size,
    })
    panel.api.setActive()
    syncDock()
  })
  return { window: panel.group, dx, dy, from: { x, y } }
}

/** Moves a picked-up window so the grabbed spot stays under the pointer. */
export function moveWindow(grip: Grip, x: number, y: number) {
  moveTo(grip.window, x - grip.dx, y - grip.dy)
}

/** The box a drop would give the moving window, in viewport pixels. */
export function dropBox(
  group: DockviewGroupPanel,
  target: DropTarget
): Box | undefined {
  const root = dockRoot()?.getBoundingClientRect()
  if (!root) return
  if (target.kind === "merge") {
    const box = boxOf(target.group)
    return (
      box && { ...box, left: box.left + root.left, top: box.top + root.top }
    )
  }
  const model = snap(snaps(), group.id, target.region, target.beside)
  const box = tiles(model).get(group.id)
  return box && { ...box, left: box.left + root.left, top: box.top + root.top }
}

/** Lands a moved window: as a tab of another window, or snapped. */
export function landWindow(group: DockviewGroupPanel, target: DropTarget) {
  if (target.kind === "snap") {
    arrange((model) => snap(model, group.id, target.region, target.beside))
    return
  }
  animateLayout(api(), () => {
    const panel = group.activePanel
    group.api.moveTo({ group: target.group, position: "center" })
    panel?.api.setActive()
    syncDock()
  })
  saveLayout()
}

/** Puts a picked-up window back where it was, as the drag is cancelled. */
export function returnWindow(grip: Grip) {
  const { before } = grip
  if (before && regionOf(before, grip.window.id)) arrange(() => before)
  else moveWindow(grip, grip.from.x, grip.from.y)
}

/* Persistence */

/**
 * Saves the layout, except while a window is fullscreen: a reload comes
 * back to the layout the user arranged, not to one window.
 */
export function saveLayout() {
  const dock = api()
  if (!dock || useDock.getState().maximized) return
  try {
    const saved: SavedLayout = {
      version: LAYOUT_VERSION,
      layout: dock.toJSON(),
      snaps: snaps(),
      minimized: useDock.getState().minimized,
      stowed: useDock.getState().stowed,
      places,
    }
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(saved))
  } catch {
    // The layout still works for this session without storage.
  }
}

/** Restores the saved layout, or builds the default preset. */
export function loadLayout(dock: DockviewApi) {
  useDock.setState({ api: dock })
  quietly(() => restoreLayout(dock))
}

function restoreLayout(dock: DockviewApi) {
  try {
    const saved = JSON.parse(
      localStorage.getItem(LAYOUT_KEY) || "null"
    ) as SavedLayout | null
    if (saved?.version === LAYOUT_VERSION) {
      dock.fromJSON(saved.layout as Parameters<DockviewApi["fromJSON"]>[0])
      places = saved.places ?? {}
      useDock.setState({
        snaps: readSnaps(saved.snaps),
        stowed: saved.stowed.filter(
          (item) => item.component in PANELS && !dock.getPanel(item.id)
        ),
        minimized: saved.minimized.filter((item) => dock.getGroup(item.group)),
      })
      for (const item of useDock.getState().minimized) {
        const box = floatingBox(dock.getGroup(item.group) as DockviewGroupPanel)
        if (box) box.hidden = true
      }
      ensureWindows(dock)
      syncDock()
      laidOut = workbench()
      layOut()
      return
    }
  } catch {
    // A layout from an older build falls back to the default below.
  }
  applyPreset("default")
}

/**
 * Every built-in tab stays reachable: one missing from both the layout and
 * the tray (an older or damaged layout) waits in the tray, to be opened
 * where the user wants it.
 */
function ensureWindows(dock: DockviewApi) {
  const stowed = useDock.getState().stowed
  const missing = (Object.keys(PANELS) as PanelId[]).filter(
    (id) =>
      !PANELS[id].closable &&
      !dock.panels.some((panel) => panel.view.contentComponent === id) &&
      !stowed.some((item) => item.component === id)
  )
  useDock.setState({
    stowed: [
      ...stowed,
      ...missing.map((id) => ({ id, component: id, title: PANELS[id].title })),
    ],
  })
}

export function applyPreset(preset: PresetId) {
  quietly(() => buildLayout(preset))
}

function buildLayout(preset: PresetId) {
  const dock = api()
  if (!dock) return
  useDock.setState({
    maximized: undefined,
    minimized: [],
    stowed: [],
    snaps: emptySnaps(),
  })
  dock.clear()
  places = {}
  const open = (ids: PanelId[]) =>
    openWindow(
      ids.map((id) => ({ id, component: id, title: PANELS[id].title })),
      freshBox()
    ).id
  useDock.setState({ snaps: buildPreset(preset, open, workbench()) })
  syncDock()
  laidOut = workbench()
  layOut()
  saveLayout()
}
