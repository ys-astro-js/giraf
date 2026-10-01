import { createPortal } from "react-dom"
import type { DockviewGroupPanel } from "dockview-react"
import {
  PanelBottom,
  PanelLeft,
  PanelRight,
  PanelTop,
  type LucideIcon,
} from "lucide-react"
import { usePicker } from "./drag"
import { useDock, type Side } from "./store"

const SIDES: [Side, LucideIcon, string][] = [
  ["left", PanelLeft, "왼쪽에 나란히"],
  ["right", PanelRight, "오른쪽에 나란히"],
  ["top", PanelTop, "위에 나란히"],
  ["bottom", PanelBottom, "아래에 나란히"],
]

/**
 * While a window is dragged over a snapped window's top bar, that bar shows
 * where the window can go beside it within its region, after the snap
 * layouts desktop systems offer. The pointer picks a side by resting on it (drag.ts hit-tests the
 * buttons); anywhere else on the bar the window joins as a tab.
 */
export function DropPicker() {
  const { group, sides, side } = usePicker()
  const dock = useDock((state) => state.api)
  const host = document.querySelector(".giraf-app")
  const hovered = group
    ? (dock?.getGroup(group) as DockviewGroupPanel | undefined)
    : undefined
  const bar = hovered?.element
    .querySelector(".dv-tabs-and-actions-container")
    ?.getBoundingClientRect()
  if (!host || !bar) return null
  return createPortal(
    <div
      className="dock-drop-picker"
      style={{ top: bar.top, right: window.innerWidth - bar.right }}
      aria-hidden="true"
    >
      <div className="toolbar-group">
        {SIDES.filter(([value]) => sides.includes(value)).map(
          ([value, Icon, label]) => (
            <span
              key={value}
              className="dock-drop-picker-button"
              data-side={value}
              aria-pressed={side === value}
              title={label}
            >
              <Icon />
            </span>
          )
        )}
      </div>
    </div>,
    host
  )
}
