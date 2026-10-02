import { create } from "zustand"
import type {
  DockviewApi,
  DockviewGroupPanel,
  IDockviewPanel,
} from "dockview-react"
import { PANELS, type PanelId } from "./panels"
import { recordBars } from "./morph"
import {
  buildDefault,
  canDrop,
  CANVAS,
  canvasGroup,
  columnGroups,
  columnWidth,
  COLUMN,
  dockPosition,
  dockTarget,
  fitColumn,
  fixCanvas,
  groupKind,
  isDocked,
  KINDS,
  type DropPlace,
} from "./layout"

/*
 * The workbench: the workflow canvas, and a column on the right holding the
 * node and viewer windows (see layout.ts). A window can float over the
 * workbench and dock again. Below the workbench, outside the dock, sits the
 * run tray. The column's width and the tray's height stay in pixels.
 */

/** What a locked tab keeps showing instead of following the selection. */
export type WindowParams = { locked?: string }

type Box = { left: number; top: number; width: number; height: number }

/** The run tray's height when nobody has set it, and its floor. */
export const TRAY_HEIGHT = 240
export const MIN_TRAY = 120

type DockState = {
  api?: DockviewApi
  /** The right column's width in pixels. */
  column: number
  /** The run tray below the workbench. */
  tray: { open: boolean; height: number }
  /** The window filling the workbench (a group id), if any. */
  maximized?: string
  /** Bumped on every structural change so window chrome re-reads it. */
  revision: number
}

export const useDock = create<DockState>()(() => ({
  column: COLUMN,
  tray: { open: false, height: TRAY_HEIGHT },
  revision: 0,
}))

const LAYOUT_KEY = "giraf-dock-layout"
const LAYOUT_VERSION = 6
type SavedLayout = {
  version: number
  layout: unknown
  column: number
  tray: DockState["tray"]
}

const api = () => useDock.getState().api

/* Laying out */

/** The element floating windows are placed in. */
const floatHost = () =>
  document.querySelector(".dock-root .dv-floating-overlay-host") ??
  document.querySelector(".dock-root")

function floatingBox(group: DockviewGroupPanel) {
  return group.element.closest<HTMLElement>(".dv-resize-container")
}

/** A window's box, relative to where floating windows are placed. */
function boxOf(group: DockviewGroupPanel): Box {
  const rect = (floatingBox(group) ?? group.element).getBoundingClientRect()
  const host = floatHost()?.getBoundingClientRect()
  return {
    left: rect.left - (host?.left ?? 0),
    top: rect.top - (host?.top ?? 0),
    width: rect.width,
    height: rect.height,
  }
}

/** Puts a floating window at a box relative to the float host. */
function place(group: DockviewGroupPanel, box: Box) {
  const element = floatingBox(group)
  if (!element) return
  element.style.left = `${box.left}px`
  element.style.top = `${box.top}px`
  group.api.setSize({ width: box.width, height: box.height })
}

/** The whole workbench, as a box for a floating window. */
function wholeBox(dock: DockviewApi): Box {
  return { left: 0, top: 0, width: dock.width, height: dock.height }
}

/**
 * Lays the dock out at the workbench's size; the column keeps its width
 * and a maximized floating window keeps filling the workbench.
 */
export function layoutDock(width: number, height: number) {
  const dock = api()
  if (!dock) return
  dock.layout(width, height)
  fitColumn(dock, useDock.getState().column)
  const maximized = maximizedGroup()
  if (maximized && !isDocked(maximized)) place(maximized, wholeBox(dock))
}

/** While the column's divider is dragged, the column takes its new width. */
let resizing = false
export function startColumnResize() {
  resizing = true
}
export function endColumnResize() {
  if (!resizing) return
  resizing = false
  const dock = api()
  const width = dock && !dock.hasMaximizedGroup() && columnWidth(dock)
  if (width) useDock.setState({ column: width })
  saveLayout()
}

/** After dockview lays the grid out: keep the column's width, or take the
 *  user's new one while they drag its divider. */
function followLayout() {
  const dock = api()
  if (!dock || dock.hasMaximizedGroup()) return
  const width = columnWidth(dock)
  if (resizing && width) useDock.setState({ column: width })
  else fitColumn(dock, useDock.getState().column)
}

/** Re-reads the layout facts the rest of the app shows. */
export function syncDock() {
  const dock = api()
  if (!dock) return
  // dockview knows which docked group is maximized; a floating one is ours.
  const docked = dock.groups.find((group) => group.api.isMaximized())
  useDock.setState((state) => {
    const floating = state.maximized
      ? (dock.getGroup(state.maximized) as DockviewGroupPanel | undefined)
      : undefined
    return {
      maximized:
        docked?.id ?? (floating && !isDocked(floating) ? floating.id : undefined),
      revision: state.revision + 1,
    }
  })
  markWindows(dock)
}

/**
 * Marks layout facts on each window's element for its bars' styles:
 * `data-tabbed` while it holds several tabs, `data-floating` while it
 * floats, `data-maximized` while it fills the workbench.
 */
function markWindows(dock: DockviewApi) {
  const maximized = useDock.getState().maximized
  for (const group of dock.groups) {
    mark(group.element, "tabbed", group.panels.length > 1)
    mark(group.element, "floating", !isDocked(group))
    mark(group.element, "maximized", group.id === maximized)
    const box = floatingBox(group)
    if (box) mark(box, "maximized", group.id === maximized)
  }
}

function mark(element: HTMLElement, name: string, on: boolean) {
  if (on) element.dataset[name] = ""
  else delete element.dataset[name]
}

type DropEvent = {
  kind: DropPlace["on"]
  position: DropPlace["position"]
  group?: DockviewGroupPanel
  getData(): { groupId: string; panelId: string | null } | undefined
  preventDefault(): void
}

/** Turns a drop dockview is about to offer or make away unless it may. */
function guardDrop(dock: DockviewApi, event: DropEvent) {
  const data = event.getData()
  const allowed =
    !!data &&
    canDrop(dock, {
      on: event.kind,
      position: event.position,
      target: event.group,
      source: data.panelId
        ? { panel: dock.getPanel(data.panelId) }
        : { group: dock.getGroup(data.groupId) as DockviewGroupPanel },
    })
  if (!allowed) event.preventDefault()
}

/** Wires the dock's events once it is ready. */
export function watchDock(dock: DockviewApi) {
  // Tabs gather only with their own kind (see canDrop).
  dock.onWillShowOverlay((event) => guardDrop(dock, event))
  dock.onWillDrop((event) => guardDrop(dock, event))
  dock.onDidDrop(() => fitColumn(dock, useDock.getState().column))
  let pending = 0
  dock.onDidLayoutChange(() => {
    followLayout()
    syncDock()
    window.clearTimeout(pending)
    pending = window.setTimeout(saveLayout, 300)
  })
  for (const event of [
    dock.onDidActiveGroupChange,
    dock.onDidActivePanelChange,
    dock.onDidAddPanel,
    dock.onDidRemovePanel,
    dock.onDidMovePanel,
    dock.onDidAddGroup,
    dock.onDidRemoveGroup,
    dock.onDidMaximizedGroupChange,
  ])
    event(syncDock)
}

/* Opening windows */

type NewWindow = { id: string; component: string; title: string }

/**
 * Opens a window: as a tab beside `beside`, else in its kind's group (docked
 * first, then floating), else as a new group in the column.
 */
function openWindow(window: NewWindow, beside?: DockviewGroupPanel) {
  const dock = api()!
  const kind = KINDS[window.component]
  const floating = dock.groups.find(
    (group) => !isDocked(group) && groupKind(group) === kind
  )
  const docked = columnGroups(dock).some((group) => groupKind(group) === kind)
  const reference = beside ?? (docked ? undefined : floating)
  const panel = dock.addPanel({
    ...window,
    position: reference
      ? { referenceGroup: reference }
      : dockPosition(dock, kind),
  })
  fitColumn(dock, useDock.getState().column)
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
  return openWindow(
    {
      id: same.length ? `${component}-${n}` : component,
      component,
      title: PANELS[component].title,
    },
    same[0]?.group
  )
}

/**
 * Shows a tab, opening it where its kind lives if it is closed. A window
 * maximized elsewhere steps back so the tab can be seen; background
 * reveals keep the focus and the arrangement.
 */
export function revealPanel(id: PanelId, { activate = true } = {}) {
  const dock = api()
  if (!dock) return
  const panel = PANELS[id].follows
    ? follower(id)
    : (dock.getPanel(id) ??
      openWindow({ id, component: id, title: PANELS[id].title }))
  if (activate) {
    const maximized = maximizedGroup()
    if (maximized && maximized !== panel.group) toggleMaximized(maximized)
    if (panel.group.activePanel !== panel) recordBars(panel.group)
    panel.api.setActive()
  }
  syncDock()
}

/** Whether a window is open. */
export function useWindowShown(id: PanelId) {
  useDock((state) => state.revision)
  return !!useDock.getState().api?.getPanel(id)
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

/** Closes a tab; an emptied group leaves the column to the others. */
export function closeTab(panel: IDockviewPanel) {
  if (panel.id === CANVAS) return
  closeActions.get(panel.id)?.()
  panel.api.close()
  const dock = api()
  if (dock) fitColumn(dock, useDock.getState().column)
  syncDock()
  saveLayout()
}

/* Windows: the window pill acts on the whole group. */

export function closeWindow(group: DockviewGroupPanel) {
  if (isMaximized(group)) toggleMaximized(group)
  for (const panel of [...group.panels]) closeTab(panel)
}

function maximizedGroup() {
  const id = useDock.getState().maximized
  return id ? (api()?.getGroup(id) as DockviewGroupPanel | undefined) : undefined
}

const isMaximized = (group: DockviewGroupPanel) =>
  isDocked(group)
    ? group.api.isMaximized()
    : useDock.getState().maximized === group.id

/** Where a floating window was before it filled the workbench. */
const beforeMaximized = new Map<string, Box>()

/**
 * Fills the workbench with a window, under the app's toolbar and above the
 * run tray, or puts it back. A docked window uses dockview's own maximize;
 * a floating one grows over the workbench and returns to its box.
 */
export function toggleMaximized(group: DockviewGroupPanel) {
  const dock = api()
  if (!dock) return
  const maximized = maximizedGroup()
  if (maximized && maximized !== group) toggleMaximized(maximized)
  if (isMaximized(group)) {
    if (isDocked(group)) group.api.exitMaximized()
    else {
      const box = beforeMaximized.get(group.id)
      beforeMaximized.delete(group.id)
      if (box) place(group, box)
    }
    useDock.setState({ maximized: undefined })
  } else {
    if (isDocked(group)) group.api.maximize()
    else {
      beforeMaximized.set(group.id, boxOf(group))
      place(group, wholeBox(dock))
    }
    useDock.setState({ maximized: group.id })
  }
  group.activePanel?.api.setActive()
  fitColumn(dock, useDock.getState().column)
  syncDock()
  saveLayout()
}

/** A floating window's size when it leaves the column. */
const FLOAT = { width: 480, height: 400 }

/** Lifts a docked window out of the column to float over the workbench. */
export function detachWindow(group: DockviewGroupPanel) {
  const dock = api()
  if (!dock || !isDocked(group)) return
  if (isMaximized(group)) toggleMaximized(group)
  const box = boxOf(group)
  const width = Math.min(Math.max(box.width, 320), FLOAT.width)
  const height = Math.min(Math.max(box.height * 0.8, 240), FLOAT.height)
  // It floats just to the left of where it sat, so it reads as lifted out.
  const left = Math.max(0, Math.min(box.left - 48, dock.width - width))
  const top = Math.max(0, Math.min(box.top + 48, dock.height - height))
  dock.addFloatingGroup(group, { position: { left, top }, width, height })
  fitColumn(dock, useDock.getState().column)
  syncDock()
  saveLayout()
}

/**
 * Docks a floating window again: as tabs of its kind's group in the column,
 * or as a new group there, node windows above viewers.
 */
export function attachWindow(group: DockviewGroupPanel) {
  const dock = api()
  if (!dock || isDocked(group)) return
  if (isMaximized(group)) toggleMaximized(group)
  const kind = groupKind(group)
  if (!kind) return
  const active = group.activePanel
  const target = dockTarget(dock, kind)
  if (!target) return
  group.api.moveTo(target)
  active?.api.setActive()
  fitColumn(dock, useDock.getState().column)
  syncDock()
  saveLayout()
}

/* The run tray */

export function toggleTray(open = !useDock.getState().tray.open) {
  useDock.setState((state) => ({ tray: { ...state.tray, open } }))
  saveLayout()
}

export function resizeTray(height: number, save = false) {
  useDock.setState((state) => ({
    tray: { ...state.tray, height: Math.max(MIN_TRAY, Math.round(height)) },
  }))
  if (save) saveLayout()
}

/* Persistence */

/** Saves the layout, except while a window is maximized. */
export function saveLayout() {
  const dock = api()
  if (!dock || useDock.getState().maximized) return
  try {
    const { column, tray } = useDock.getState()
    const saved: SavedLayout = {
      version: LAYOUT_VERSION,
      layout: dock.toJSON(),
      column,
      tray,
    }
    localStorage.setItem(LAYOUT_KEY, JSON.stringify(saved))
  } catch {
    // The layout still works for this session without storage.
  }
}

/**
 * Restores the saved layout, or starts from the default one. Layouts saved
 * by an older build are ignored.
 */
export function loadLayout(dock: DockviewApi) {
  useDock.setState({ api: dock })
  try {
    const saved = JSON.parse(
      localStorage.getItem(LAYOUT_KEY) || "null"
    ) as SavedLayout | null
    if (saved?.version === LAYOUT_VERSION) {
      dock.fromJSON(saved.layout as Parameters<DockviewApi["fromJSON"]>[0])
      if (canvasGroup(dock)) {
        useDock.setState({ column: saved.column, tray: saved.tray })
        fixCanvas(dock)
        fitColumn(dock, saved.column)
        syncDock()
        return
      }
    }
  } catch {
    // A damaged layout falls back to the default below.
  }
  resetLayout()
}

/** The default arrangement: canvas, node window above the viewer. */
export function resetLayout() {
  const dock = api()
  if (!dock) return
  useDock.setState({ maximized: undefined, column: COLUMN })
  buildDefault(
    dock,
    (["workflow", "inspector", "viewer"] as PanelId[]).map((id) => ({
      id,
      component: id,
      title: PANELS[id].title,
    }))
  )
  fitColumn(dock, COLUMN)
  syncDock()
  saveLayout()
}
