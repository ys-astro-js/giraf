import { useState, useSyncExternalStore, type DragEvent } from "react"
import {
  GripVertical,
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  Minus,
  X,
} from "lucide-react"
import {
  LocalSelectionTransfer,
  PanelTransfer,
  type IDockviewHeaderActionsProps,
  type IDockviewPanel,
} from "dockview-react"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { usePanel } from "./context"
import {
  beginWindowDrag,
  canClose,
  canLock,
  canMaximize,
  endWindowDrag,
  minimizeWindow,
  toggleLock,
  toggleMaximized,
  useDock,
  type WindowParams,
} from "./store"

function startDrag(event: DragEvent, panel: IDockviewPanel) {
  const dock = useDock.getState().api
  if (!dock) return
  LocalSelectionTransfer.getInstance<PanelTransfer>().setData(
    [new PanelTransfer(dock.id, panel.group.id, panel.id)],
    PanelTransfer.prototype
  )
  event.dataTransfer.effectAllowed = "move"
  event.dataTransfer.setData("text/plain", panel.title ?? panel.id)
  const ghost = document.createElement("div")
  ghost.className = "dock-drag-ghost"
  ghost.textContent = panel.title ?? panel.id
  document.body.append(ghost)
  event.dataTransfer.setDragImage(ghost, 16, 14)
  requestAnimationFrame(() => ghost.remove())
  beginWindowDrag(panel)
}

function endDrag(event: DragEvent) {
  LocalSelectionTransfer.getInstance<PanelTransfer>().clearData(
    PanelTransfer.prototype
  )
  endWindowDrag(event.nativeEvent)
}

/**
 * The window's controls at the start of its first row. Only the active
 * window shows its dots; hovering them opens close, minimize, maximize,
 * lock and the drag handle. A locked window keeps a lock in the slot.
 */
export function ControlSlot({
  panel,
  active,
}: {
  panel: IDockviewPanel
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const maximized = useDock((state) => state.maximized)
  const locked = !!(panel.params as WindowParams | undefined)?.locked
  const expanded = open && active
  return (
    <span
      className="window-controls"
      data-active={active}
      data-open={expanded}
      onPointerLeave={() => setOpen(false)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false)
      }}
    >
      {expanded ? (
        <ToolbarGroup label="창 조작" size="sm">
          <ToolbarButton
            label="닫기"
            disabled={!canClose(panel)}
            onClick={() => panel.api.close()}
          >
            <X />
          </ToolbarButton>
          <ToolbarButton label="최소화" onClick={() => minimizeWindow(panel)}>
            <Minus />
          </ToolbarButton>
          <ToolbarButton
            label={maximized ? "원래 크기로" : "최대화"}
            disabled={!canMaximize(panel)}
            onClick={() => toggleMaximized(panel)}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </ToolbarButton>
          {canLock(panel) && (
            <ToolbarButton
              label={locked ? "잠금 해제" : "선택을 따라가지 않도록 잠금"}
              aria-pressed={locked}
              onClick={() => toggleLock(panel)}
            >
              {locked ? <Lock /> : <LockOpen />}
            </ToolbarButton>
          )}
          <span className="window-controls-divider" aria-hidden="true" />
          <ToolbarButton
            label="끌어서 옮기기"
            className="window-controls-grip"
            draggable
            onDragStart={(event) => startDrag(event, panel)}
            onDragEnd={endDrag}
          >
            <GripVertical />
          </ToolbarButton>
        </ToolbarGroup>
      ) : active ? (
        <button
          type="button"
          className="window-controls-dots"
          aria-label="창 조작"
          onPointerEnter={() => setOpen(true)}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
        >
          <i />
          <i />
          <i />
        </button>
      ) : locked ? (
        <Lock className="window-controls-lock" aria-label="잠김" />
      ) : null}
    </span>
  )
}

/**
 * Placed at the start of a window's first row. Renders nothing when the
 * window's group shows a tab strip; the strip carries the controls then.
 */
export function WindowControls({ className }: { className?: string }) {
  const context = usePanel()
  useDock((state) => state.revision)
  if (!context) return null
  const { panel } = context
  if (!panel.group.model.header.hidden) return null
  return (
    <span className={className}>
      <ActiveSlot panel={panel} />
    </span>
  )
}

function ActiveSlot({ panel }: { panel: IDockviewPanel }) {
  const active = useSyncExternalStore(
    (change) => {
      const listeners = [
        panel.api.onDidActiveGroupChange(change),
        panel.api.onDidGroupChange(change),
      ]
      return () => listeners.forEach((listener) => listener.dispose())
    },
    () => panel.api.isGroupActive
  )
  return <ControlSlot panel={panel} active={active} />
}

/** The same slot before a tab strip, acting on the shown window. */
export function HeaderControls(props: IDockviewHeaderActionsProps) {
  useDock((state) => state.revision)
  if (!props.activePanel || props.group.model.header.hidden) return null
  return <ControlSlot panel={props.activePanel} active={props.isGroupActive} />
}
