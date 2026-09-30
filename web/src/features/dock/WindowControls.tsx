import { useState } from "react"
import { Maximize2, Minimize2, Minus, X } from "lucide-react"
import type {
  DockviewGroupPanel,
  IDockviewHeaderActionsProps,
} from "dockview-react"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import {
  closeWindow,
  dockWindow,
  dropPreview,
  dropTargetAt,
  isFloating,
  liftWindow,
  minimizeWindow,
  moveFloating,
  toggleMaximized,
  useDock,
  type DropTarget,
} from "./store"

const DRAG_THRESHOLD = 4

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
 * Dragging the pill moves the whole window: it lifts out of the layout and
 * follows the pointer, and docks where it is released over a target.
 */
function startWindowDrag(group: DockviewGroupPanel, x: number, y: number) {
  let moving: DockviewGroupPanel | undefined
  let target: DropTarget | undefined
  // Window listeners: the pill may leave the page when its window lifts out.
  function move(event: globalThis.PointerEvent) {
    if (!moving) {
      if (Math.hypot(event.clientX - x, event.clientY - y) < DRAG_THRESHOLD)
        return
      moving = isFloating(group)
        ? group
        : liftWindow(group, event.clientX, event.clientY)
      document.body.dataset.windowDragging = "true"
    }
    moveFloating(moving, event.clientX, event.clientY)
    target = dropTargetAt(event.clientX, event.clientY, moving)
    showPreview(target)
  }
  function end() {
    window.removeEventListener("pointermove", move)
    window.removeEventListener("pointerup", end)
    window.removeEventListener("pointercancel", end)
    delete document.body.dataset.windowDragging
    showPreview(undefined)
    if (moving && target) dockWindow(moving, target)
  }
  window.addEventListener("pointermove", move)
  window.addEventListener("pointerup", end)
  window.addEventListener("pointercancel", end)
}

/**
 * The window's handle at the start of its header: a small pill that grows
 * into close, minimize and maximize for the whole window, and moves the
 * window when dragged.
 */
export function WindowPill({
  group,
  active,
}: {
  group: DockviewGroupPanel
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const maximized = useDock((state) => state.maximized === group.id)
  return (
    <span
      className="window-pill"
      data-active={active}
      data-open={open}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false)
      }}
    >
      <button
        type="button"
        className="window-pill-handle"
        aria-label="창 옮기기"
        title="끌어서 창 옮기기"
        onPointerDown={(event) => {
          if (event.button !== 0) return
          event.preventDefault()
          startWindowDrag(group, event.clientX, event.clientY)
        }}
      >
        <i />
        <i />
        <i />
      </button>
      <span className="window-pill-actions" aria-hidden={!open}>
        <ToolbarGroup label="창 조작" size="sm">
          <ToolbarButton
            label="창 닫기"
            tabIndex={open ? 0 : -1}
            onClick={() => closeWindow(group)}
          >
            <X />
          </ToolbarButton>
          <ToolbarButton
            label="창 최소화"
            tabIndex={open ? 0 : -1}
            onClick={() => minimizeWindow(group)}
          >
            <Minus />
          </ToolbarButton>
          <ToolbarButton
            label={maximized ? "원래 크기로" : "창 최대화"}
            tabIndex={open ? 0 : -1}
            onClick={() => toggleMaximized(group)}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </ToolbarButton>
        </ToolbarGroup>
      </span>
    </span>
  )
}

/** Every window header starts with its pill. */
export function HeaderControls(props: IDockviewHeaderActionsProps) {
  useDock((state) => state.revision)
  return <WindowPill group={props.group} active={props.isGroupActive} />
}
