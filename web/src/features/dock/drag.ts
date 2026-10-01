import { create } from "zustand"
import type { DockviewGroupPanel, IDockviewPanel } from "dockview-react"
import { recordBars } from "./morph"
import { EASE } from "./motion"
import {
  dockRoot,
  dropBox,
  followResize,
  isSnapped,
  landWindow,
  liftTab,
  liftWindow,
  moveWindow,
  returnWindow,
  sidesOf,
  useDock,
  type DropTarget,
  type Grip,
  type Region,
  type Side,
} from "./store"

/*
 * Moving windows the way desktop systems do. A window picked up is a free
 * window under the pointer; a snapped one leaves its place, and nothing
 * else moves. Released anywhere, it stays there. It snaps only where the
 * pointer itself touches: an edge of the workbench snaps it along that
 * side, the top edge into the space the snapped sides leave, another
 * window's top bar takes it in as a tab, and the placement picker that a
 * snapped window's bar then shows places it beside that window. Escape
 * puts it back. The preview shows the very box the drop gives.
 */

const DRAG_THRESHOLD = 4
/** How far a tab leaves its strip before it becomes a window of its own. */
const DETACH_DISTANCE = 16
/** How close the pointer must come to the workbench's edge to snap there. */
const EDGE = 6
/**
 * The workbench's top edge is not the screen's, where a pointer would come
 * to rest: it borders the app's own bar. So anywhere over that bar, or this
 * close below it, counts as the top edge.
 */
const TOP_EDGE = 24

type Point = { x: number; y: number }
type Start = Point & { pointerId: number }

/**
 * The placement picker a snapped window's top bar shows while a window is
 * dragged over it, the sides it offers, and the one the pointer is on.
 */
export const usePicker = create<{
  group?: string
  sides: Side[]
  side?: Side
}>()(() => ({ sides: [] }))

/**
 * The window drawn topmost at a point, other than the one being dragged:
 * later-focused windows cover the others.
 */
function windowAt(x: number, y: number, dragged: DockviewGroupPanel) {
  const dock = useDock.getState().api
  if (!dock) return
  for (const element of document.elementsFromPoint(x, y)) {
    if (dragged.element.contains(element)) continue
    const group = dock.groups.find((g) => g.element.contains(element))
    if (group) return group
  }
}

/** The picker button under a point, if the picker is showing. */
function pickedSide(x: number, y: number) {
  for (const button of document.querySelectorAll<HTMLElement>(
    ".dock-drop-picker [data-side]"
  )) {
    const rect = button.getBoundingClientRect()
    if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
      return button.dataset.side as Side
  }
}

/** The region a snapped window is in. */
function regionOfGroup(group: DockviewGroupPanel) {
  const { regions } = useDock.getState().snaps
  return (Object.keys(regions) as Region[]).find((region) =>
    regions[region].includes(group.id)
  )
}

/** Where a window released at a point would land, if anywhere. */
function targetAt(
  x: number,
  y: number,
  dragged: DockviewGroupPanel
): DropTarget | undefined {
  const box = dockRoot()?.getBoundingClientRect()
  if (!box) return
  if (x <= box.left + EDGE) return { kind: "snap", region: "left" }
  if (x >= box.right - EDGE) return { kind: "snap", region: "right" }
  if (y >= box.bottom - EDGE) return { kind: "snap", region: "bottom" }
  // The top edge fills the center; a center already holding a window takes
  // the dragged one beside it, so the edge always does something.
  if (y <= box.top + TOP_EDGE) return { kind: "snap", region: "center" }
  const group = windowAt(x, y, dragged)
  if (!group) return
  if (useDock.getState().minimized.some((m) => m.group === group.id)) return
  const header = group.element
    .querySelector(".dv-tabs-and-actions-container")
    ?.getBoundingClientRect()
  if (!header || y > header.bottom) return
  const region = regionOfGroup(group)
  const side = region ? pickedSide(x, y) : undefined
  if (region && side && sidesOf(group).includes(side))
    return { kind: "snap", region, beside: { id: group.id, side } }
  return { kind: "merge", group }
}

/** The translucent area a released window would take. */
function showPreview(dragged: DockviewGroupPanel, target?: DropTarget) {
  let element = document.querySelector<HTMLElement>(".dock-drop-preview")
  const box = target && dropBox(dragged, target)
  if (!box) {
    element?.remove()
    return
  }
  if (!element) {
    element = document.createElement("div")
    element.className = "dock-drop-preview"
    document.body.append(element)
  }
  Object.assign(element.style, {
    left: `${box.left}px`,
    top: `${box.top}px`,
    width: `${box.width}px`,
    height: `${box.height}px`,
  })
}

/** Shows the picker on the snapped window whose top bar the pointer is on. */
function showPicker(target?: DropTarget) {
  const dock = useDock.getState().api
  const over =
    target?.kind === "merge"
      ? target.group
      : target?.kind === "snap" && target.beside
        ? (dock?.getGroup(target.beside.id) as DockviewGroupPanel | undefined)
        : undefined
  const group = over && isSnapped(over) ? over : undefined
  usePicker.setState({
    group: group?.id,
    sides: group ? sidesOf(group) : [],
    side: target?.kind === "snap" ? target.beside?.side : undefined,
  })
}

/** A window just picked up settles under the pointer from where it was. */
function settleLifted(grip: Grip) {
  const box = grip.window.element.closest<HTMLElement>(".dv-resize-container")
  if (!box || !grip.before) return
  box.style.transformOrigin = `${grip.dx}px ${grip.dy}px`
  box.animate(
    [
      { transform: "scale(1.04)", opacity: 0.85 },
      { transform: "none", opacity: 1 },
    ],
    { duration: 180, easing: EASE }
  )
}

/**
 * Tracks one pointer drag on window listeners, since the element that
 * started it may leave the page. Once it starts, the workbench captures the
 * pointer, so a drag that strays past the page's edge (as toward the top
 * edge) keeps reporting, as browsers otherwise stop (Safari). Escape
 * cancels it.
 */
function track(
  from: Start,
  handlers: {
    move: (point: Point) => void
    end: () => void
    cancel: () => void
  },
  threshold = DRAG_THRESHOLD,
  capture = true
) {
  let started = false
  const root = capture ? dockRoot() : null
  function move(event: PointerEvent) {
    const point = { x: event.clientX, y: event.clientY }
    if (!started) {
      if (Math.hypot(point.x - from.x, point.y - from.y) < threshold) return
      started = true
      document.body.dataset.windowDragging = "true"
      try {
        root?.setPointerCapture(from.pointerId)
      } catch {
        // A pointer that already ended cannot be captured; the drag goes on.
      }
    }
    handlers.move(point)
  }
  function key(event: KeyboardEvent) {
    if (!started || event.key !== "Escape") return
    event.preventDefault()
    stop()
    handlers.cancel()
  }
  function stop() {
    if (root?.hasPointerCapture(from.pointerId))
      root.releasePointerCapture(from.pointerId)
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
    window.removeEventListener("pointercancel", cancel)
    window.removeEventListener("keydown", key, true)
    delete document.body.dataset.windowDragging
  }
  function end() {
    stop()
    if (started) handlers.end()
  }
  function cancel() {
    stop()
    if (started) handlers.cancel()
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", end)
  window.addEventListener("pointercancel", cancel)
  window.addEventListener("keydown", key, true)
}

/** Moves a picked-up window with the pointer and lands it on release. */
function follow(grip: Grip) {
  let target: DropTarget | undefined
  const clear = () => {
    showPreview(grip.window)
    showPicker()
  }
  return {
    move(point: Point) {
      moveWindow(grip, point.x, point.y)
      target = targetAt(point.x, point.y, grip.window)
      showPreview(grip.window, target)
      showPicker(target)
    },
    end() {
      clear()
      if (target) landWindow(grip.window, target)
    },
    cancel() {
      clear()
      returnWindow(grip)
    },
  }
}

/** Drags a whole window: a snapped one is picked up out of its place. */
export function startWindowDrag(group: DockviewGroupPanel, from: Start) {
  let moving: ReturnType<typeof follow> | undefined
  track(from, {
    move(point) {
      if (!moving) {
        const grip = liftWindow(group, from.x, from.y)
        settleLifted(grip)
        moving = follow(grip)
      }
      moving.move(point)
    },
    end: () => moving?.end(),
    cancel: () => moving?.cancel(),
  })
}

/**
 * Drags one tab: along its strip it reorders; pulled away it becomes a
 * free window of its own that moves like any other.
 */
export function startTabDrag(panel: IDockviewPanel, from: Start) {
  const group = panel.group
  let moving: ReturnType<typeof follow> | undefined
  track(from, {
    move(point) {
      if (!moving) {
        const strip = group.element
          .querySelector(".dv-tabs-and-actions-container")
          ?.getBoundingClientRect()
        const inside =
          strip &&
          point.y > strip.top - DETACH_DISTANCE &&
          point.y < strip.bottom + DETACH_DISTANCE &&
          point.x > strip.left &&
          point.x < strip.right
        if (inside) {
          reorder(panel, point.x)
          return
        }
        moving = follow(liftTab(panel, point.x, point.y))
      }
      moving.move(point)
    },
    end: () => moving?.end(),
    cancel: () => moving?.cancel(),
  })
}

/** Moves a tab to where the pointer is along its strip. */
function reorder(panel: IDockviewPanel, x: number) {
  const group = panel.group
  const tabs = [
    ...group.element.querySelectorAll<HTMLElement>(
      ".dv-tabs-container > .dv-tab"
    ),
  ]
  const index = tabs.findIndex((tab) => {
    const rect = tab.getBoundingClientRect()
    return x < rect.left + rect.width / 2
  })
  const target = index < 0 ? tabs.length : index
  const current = group.panels.indexOf(panel)
  if (target === current || target === current + 1) return
  panel.api.moveTo({
    group,
    index: target > current ? target - 1 : target,
  })
}

/**
 * Resizing a snapped window by an edge (dockview's own handles move the
 * edge): the snapped windows around it follow as the pointer moves.
 */
function startResize(group: DockviewGroupPanel, from: Start) {
  // While the pointer moves, once a frame; on release, at once.
  let frame = 0
  const move = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => followResize(group))
  }
  const done = () => {
    cancelAnimationFrame(frame)
    followResize(group)
  }
  // dockview's handle drives the edge; capturing here would take its pointer.
  track(from, { move, end: done, cancel: done }, 0, false)
}

/** Controls in a header keep the pointer; the rest of it is a handle. */
const CONTROLS =
  "button, input, select, textarea, a, [role='button'], [contenteditable]"

/**
 * The window header is the handle: its clear toolbar row and tab bar move
 * the window, a tab among others moves that tab. Controls keep their clicks.
 * A snapped window's resize edges move its neighbors with it.
 */
export function headerPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target as HTMLElement
  const dock = useDock.getState().api
  const from = {
    x: event.clientX,
    y: event.clientY,
    pointerId: event.pointerId,
  }
  const handle = target.closest("[class*='dv-resize-handle']")
  if (handle) {
    const container = handle.closest(".dv-resize-container")
    const group = dock?.groups.find((g) => container?.contains(g.element))
    if (group && isSnapped(group)) startResize(group, from)
    return
  }
  const header = target.closest(".dv-tabs-and-actions-container")
  if (!header || target.closest(CONTROLS)) return
  const group = dock?.groups.find((g) => g.element.contains(header))
  if (!group) return
  const id = target.closest<HTMLElement>("[data-panel-id]")?.dataset.panelId
  const panel = id ? group.panels.find((p) => p.id === id) : undefined
  // The shown tab may change: its bars leave with it, so record them now.
  if (panel && group.activePanel !== panel) recordBars(group)
  if (panel && group.panels.length > 1) startTabDrag(panel, from)
  else startWindowDrag(group, from)
}
