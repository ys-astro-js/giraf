import type { DockviewGroupPanel, IDockviewPanel } from "dockview-react"
import { recordBars } from "./morph"
import { EASE } from "./motion"
import {
  dockRoot,
  dockSource,
  floatingSize,
  floatSource,
  holdFloating,
  isFloating,
  moveFloating,
  toggleMaximized,
  useDock,
  type DragSource,
  type DropPosition,
  type DropTarget,
} from "./store"

/*
 * Moving windows by zones. While a window is dragged the layout holds
 * still: the window stays, dimmed, in its place, and a stand-in follows the
 * pointer (a floating window simply moves). The window under the pointer is
 * the target: its middle joins its tabs, the rest of it places the dragged
 * window beside it on the nearest side, and a band along the workbench's
 * own edges docks along that whole side. A new target takes over only once
 * the pointer rests on it, so passing over windows does not flicker.
 * Holding Shift drops a floating window; releasing with no target, or
 * pressing Escape, puts the window back.
 */

const DRAG_THRESHOLD = 4
/** How far a tab leaves its strip before it becomes a window of its own. */
const DETACH_DISTANCE = 16
/** How close to the workbench's border a drop docks along that whole side. */
const EDGE_BAND = 24
/** A window's middle, as a share of its width and height, joins its tabs. */
const MERGE_ZONE = 0.4
/** How long the pointer rests on a new target before it takes over. */
const DWELL = 140
/** How much of the workbench a drop along one of its sides would take, at most. */
const EDGE_PREVIEW = { width: 320, height: 240 }

type Point = { x: number; y: number }

/**
 * The window drawn topmost at a point: floating windows cover docked ones,
 * and later-focused floats the rest. A window being dragged whole is not
 * a place to drop it.
 */
function windowAt(x: number, y: number, dragged?: DockviewGroupPanel) {
  const dock = useDock.getState().api
  if (!dock) return
  for (const element of document.elementsFromPoint(x, y)) {
    if (dragged?.element.contains(element)) continue
    const group = dock.groups.find((g) => g.element.contains(element))
    if (group) return group
  }
}

/** Where a drag released at a point would land, if anywhere. */
function targetAt(
  x: number,
  y: number,
  source: DragSource
): DropTarget | undefined {
  const box = dockRoot()?.getBoundingClientRect()
  if (!box) return
  const group = windowAt(x, y, source.panel ? undefined : source.group)
  // A tab may split its own window, but joining it changes nothing.
  const self = group === source.group
  // A floating window holds one group: it only takes tabs.
  if (group && isFloating(group))
    return self ? undefined : { kind: "group", group, position: "center" }
  if (x - box.left < EDGE_BAND) return { kind: "edge", edge: "left" }
  if (box.right - x < EDGE_BAND) return { kind: "edge", edge: "right" }
  if (box.bottom - y < EDGE_BAND) return { kind: "edge", edge: "bottom" }
  if (!group) return
  if (useDock.getState().minimized.some((m) => m.group === group.id)) return
  const rect = group.element.getBoundingClientRect()
  const u = (x - rect.left) / rect.width
  const v = (y - rect.top) / rect.height
  const inset = (1 - MERGE_ZONE) / 2
  if (u > inset && u < 1 - inset && v > inset && v < 1 - inset)
    return self ? undefined : { kind: "group", group, position: "center" }
  const sides: [DropPosition, number][] = [
    ["left", u],
    ["right", 1 - u],
    ["top", v],
    ["bottom", 1 - v],
  ]
  const [side] = sides.sort((a, b) => a[1] - b[1])[0]
  return { kind: "group", group, position: side }
}

const targetKey = (target?: DropTarget) =>
  !target
    ? ""
    : target.kind === "edge"
      ? `edge:${target.edge}`
      : `${target.group.id}:${target.position}`

type Area = { left: number; top: number; width: number; height: number }

/** A plain copy: a DOMRect's fields are getters that spreading drops. */
const areaOf = ({ left, top, width, height }: DOMRect): Area => ({
  left,
  top,
  width,
  height,
})

/** The part of an area along one side, `width` or `height` across. */
function along(area: Area, side: DropPosition, width: number, height: number) {
  switch (side) {
    case "left":
      return { ...area, width }
    case "right":
      return { ...area, left: area.left + area.width - width, width }
    case "top":
      return { ...area, height }
    case "bottom":
      return { ...area, top: area.top + area.height - height, height }
    case "center":
      return area
  }
}

/** The area a drop target would take, in viewport pixels. */
function dropPreview(target: DropTarget): Area | undefined {
  if (target.kind === "edge") {
    const box = dockRoot()?.getBoundingClientRect()
    if (!box) return
    const width = Math.min(EDGE_PREVIEW.width, box.width / 3)
    const height = Math.min(EDGE_PREVIEW.height, box.height / 3)
    return along(areaOf(box), target.edge, width, height)
  }
  const rect = target.group.element.getBoundingClientRect()
  return along(areaOf(rect), target.position, rect.width / 2, rect.height / 2)
}

/** The translucent area a released window would take. */
function showPreview(target: DropTarget | undefined) {
  let element = document.querySelector<HTMLElement>(".dock-drop-preview")
  const box = target && dropPreview(target)
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

/** The stand-in that follows the pointer: the window as it would float. */
function createGhost(title: string, size: { width: number; height: number }) {
  const element = document.createElement("div")
  element.className = "dock-drag-ghost"
  element.style.width = `${size.width}px`
  element.style.height = `${size.height}px`
  const label = document.createElement("span")
  label.className = "dock-drag-ghost-title"
  label.textContent = title
  element.append(label)
  document.body.append(element)
  return element
}

/** The element a drag dims in place: the window, or the pulled tab. */
function dimmed(source: DragSource) {
  if (!source.panel) return source.group.element
  return source.group.element
    .querySelector(`[data-panel-id="${CSS.escape(source.panel.id)}"]`)
    ?.closest<HTMLElement>(".dv-tab")
}

/**
 * Tracks one pointer drag on window listeners, since the element that
 * started it may leave the page. Shift and Escape count while it runs.
 */
function track(
  from: Point,
  handlers: {
    start: () => void
    move: (point: Point, shift: boolean) => void
    end: () => void
    cancel: () => void
  }
) {
  let started = false
  let point = from
  function move(event: PointerEvent) {
    point = { x: event.clientX, y: event.clientY }
    if (!started) {
      if (Math.hypot(point.x - from.x, point.y - from.y) < DRAG_THRESHOLD)
        return
      started = true
      document.body.dataset.windowDragging = "true"
      handlers.start()
    }
    handlers.move(point, event.shiftKey)
  }
  function key(event: KeyboardEvent) {
    if (!started) return
    if (event.key === "Escape") {
      event.preventDefault()
      stop()
      handlers.cancel()
    } else if (event.key === "Shift") handlers.move(point, event.shiftKey)
  }
  function stop() {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
    window.removeEventListener("pointercancel", cancel)
    window.removeEventListener("keydown", key, true)
    window.removeEventListener("keyup", key, true)
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
  window.addEventListener("keyup", key, true)
}

/**
 * One drag of a window or tab, from the point it was grabbed: follows the
 * pointer, settles on targets, and lands, floats or goes back on release.
 */
function drag(source: DragSource, from: Point) {
  const floating = !source.panel && isFloating(source.group)
  if (!floating && useDock.getState().maximized === source.group.id)
    toggleMaximized(source.group)
  const rect = source.group.element.getBoundingClientRect()
  const size = floatingSize(rect)
  // The grabbed point keeps its share of the width as the window shrinks.
  const grip = source.panel
    ? { dx: 64, dy: 20 }
    : {
        dx: Math.min(
          ((from.x - rect.left) / Math.max(rect.width, 1)) * size.width,
          size.width - 16
        ),
        dy: Math.min(from.y - rect.top, 32),
      }
  const held = floating ? holdFloating(source.group, from.x, from.y) : undefined
  const title = (source.panel ?? source.group.activePanel)?.title ?? ""
  const ghost = floating ? undefined : createGhost(title, size)
  const dim = dimmed(source)
  if (dim) dim.dataset.dragging = ""

  let point = from
  let shift = false
  let target: DropTarget | undefined
  let candidate: { key: string; target?: DropTarget; since: number } | undefined
  let timer = 0

  function settle() {
    window.clearTimeout(timer)
    const next = shift ? undefined : targetAt(point.x, point.y, source)
    const key = targetKey(next)
    if (shift || key === targetKey(target)) {
      target = next
      candidate = undefined
    } else if (candidate?.key !== key) {
      candidate = { key, target: next, since: performance.now() }
      timer = window.setTimeout(settle, DWELL)
    } else if (performance.now() - candidate.since >= DWELL) {
      target = candidate.target
      candidate = undefined
    } else timer = window.setTimeout(settle, DWELL)
    showPreview(target)
    if (ghost) ghost.dataset.floating = shift ? "true" : "false"
  }

  function finish() {
    window.clearTimeout(timer)
    showPreview(undefined)
    if (dim) delete dim.dataset.dragging
  }

  /** The ghost leaves where it is, or flies back to where it came from. */
  function dismissGhost(back: boolean) {
    if (!ghost) return
    const home = dim?.getBoundingClientRect()
    const frames: Keyframe[] =
      back && home
        ? [
            { opacity: 1 },
            {
              opacity: 0,
              left: `${home.left}px`,
              top: `${home.top}px`,
              width: `${home.width}px`,
              height: `${home.height}px`,
            },
          ]
        : [{ opacity: 1 }, { opacity: 0 }]
    const duration = back ? 240 : 120
    ghost.animate(frames, {
      duration,
      easing: back ? EASE : "ease-out",
      fill: "forwards",
    })
    window.setTimeout(() => ghost.remove(), duration + 30)
  }

  return {
    move(next: Point, withShift: boolean) {
      point = next
      shift = withShift
      if (held) moveFloating(held, point.x, point.y)
      if (ghost) {
        ghost.style.left = `${point.x - grip.dx}px`
        ghost.style.top = `${point.y - grip.dy}px`
      }
      settle()
    },
    end() {
      finish()
      if (target) {
        dismissGhost(false)
        dockSource(source, target)
      } else if (!floating && shift) {
        dismissGhost(false)
        floatSource(source, point.x - grip.dx, point.y - grip.dy, size)
      } else dismissGhost(true)
    },
    cancel() {
      finish()
      if (held) moveFloating(held, from.x, from.y)
      dismissGhost(true)
    },
  }
}

/** Drags a whole window to a place in the layout, or floats it. */
export function startWindowDrag(group: DockviewGroupPanel, from: Point) {
  let moving: ReturnType<typeof drag> | undefined
  track(from, {
    start: () => (moving = drag({ group }, from)),
    move: (point, shift) => moving?.move(point, shift),
    end: () => moving?.end(),
    cancel: () => moving?.cancel(),
  })
}

/**
 * Drags one tab: along its strip it reorders; pulled away it moves like a
 * window of its own.
 */
export function startTabDrag(panel: IDockviewPanel, from: Point) {
  const group = panel.group
  let moving: ReturnType<typeof drag> | undefined
  track(from, {
    start: () => {},
    move(point, shift) {
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
        moving = drag({ group, panel }, point)
      }
      moving.move(point, shift)
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

/** Controls in a header keep the pointer; the rest of it is a handle. */
const CONTROLS =
  "button, input, select, textarea, a, [role='button'], [contenteditable]"

/**
 * The window header is the handle: its clear toolbar row and tab bar move
 * the window, a tab among others moves that tab. Controls keep their clicks.
 */
export function headerPointerDown(event: PointerEvent) {
  if (event.button !== 0) return
  const target = event.target as HTMLElement
  const header = target.closest(".dv-tabs-and-actions-container")
  if (!header || target.closest(CONTROLS)) return
  const dock = useDock.getState().api
  const group = dock?.groups.find((g) => g.element.contains(header))
  if (!group) return
  const id = target.closest<HTMLElement>("[data-panel-id]")?.dataset.panelId
  const panel = id ? group.panels.find((p) => p.id === id) : undefined
  // The shown tab may change: its bars leave with it, so record them now.
  if (panel && group.activePanel !== panel) recordBars(group)
  const from = { x: event.clientX, y: event.clientY }
  if (panel && group.panels.length > 1) startTabDrag(panel, from)
  else startWindowDrag(group, from)
}
