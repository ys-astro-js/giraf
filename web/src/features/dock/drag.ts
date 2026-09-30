import type { DockviewGroupPanel, IDockviewPanel } from "dockview-react"
import { recordBars } from "./morph"
import {
  dockWindow,
  dropPreview,
  dropTargetAt,
  holdFloating,
  isFloating,
  liftTab,
  liftWindow,
  moveFloating,
  useDock,
  type DropTarget,
  type Grip,
} from "./store"

const DRAG_THRESHOLD = 4
/** How far a tab leaves its strip before it becomes a window of its own. */
const DETACH_DISTANCE = 16

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

/**
 * Tracks one pointer drag on window listeners, since the element that
 * started it may leave the page when its window lifts out.
 */
function track(
  x: number,
  y: number,
  handlers: {
    move: (event: PointerEvent) => void
    end: () => void
  }
) {
  let started = false
  function move(event: PointerEvent) {
    if (!started) {
      if (Math.hypot(event.clientX - x, event.clientY - y) < DRAG_THRESHOLD)
        return
      started = true
      document.body.dataset.windowDragging = "true"
    }
    handlers.move(event)
  }
  function end() {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
    window.removeEventListener("pointercancel", end)
    delete document.body.dataset.windowDragging
    if (started) handlers.end()
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", end)
  window.addEventListener("pointercancel", end)
}

/** Moves a lifted window with the pointer and docks it on release. */
function follow(grip: Grip) {
  let target: DropTarget | undefined
  return {
    move(event: PointerEvent) {
      moveFloating(grip, event.clientX, event.clientY)
      target = dropTargetAt(event.clientX, event.clientY, grip.window)
      showPreview(target)
    },
    end() {
      showPreview(undefined)
      if (target) dockWindow(grip.window, target)
    },
  }
}

/** Drags a whole window: it floats and follows, docking where released. */
export function startWindowDrag(
  group: DockviewGroupPanel,
  x: number,
  y: number
) {
  let moving: ReturnType<typeof follow> | undefined
  track(x, y, {
    move(event) {
      moving ??= follow(
        isFloating(group)
          ? holdFloating(group, x, y)
          : liftWindow(group, event.clientX, event.clientY)
      )
      moving.move(event)
    },
    end() {
      moving?.end()
    },
  })
}

/**
 * Drags one tab: along its strip it reorders; pulled away it becomes a
 * floating window of its own that docks like any other.
 */
export function startTabDrag(panel: IDockviewPanel, x: number, y: number) {
  const group = panel.group
  let moving: ReturnType<typeof follow> | undefined
  track(x, y, {
    move(event) {
      if (!moving) {
        const strip = group.element
          .querySelector(".dv-tabs-and-actions-container")
          ?.getBoundingClientRect()
        const inside =
          strip &&
          event.clientY > strip.top - DETACH_DISTANCE &&
          event.clientY < strip.bottom + DETACH_DISTANCE &&
          event.clientX > strip.left &&
          event.clientX < strip.right
        if (inside) {
          reorder(panel, event.clientX)
          return
        }
        moving = follow(liftTab(panel, event.clientX, event.clientY))
      }
      moving.move(event)
    },
    end() {
      moving?.end()
    },
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
  if (panel && group.panels.length > 1)
    startTabDrag(panel, event.clientX, event.clientY)
  else startWindowDrag(group, event.clientX, event.clientY)
}
