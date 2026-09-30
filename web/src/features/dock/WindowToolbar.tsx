import { useCallback, useSyncExternalStore, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { create } from "zustand"
import { ToolbarCluster } from "@/components/toolbar"
import {
  OverflowContext,
  ToolbarHiddenContext,
} from "@/components/toolbar-context"
import { useBarOverflow } from "./bars"
import { cn } from "@/lib/utils"
import { usePanel } from "./context"
import { useDock } from "./store"

/**
 * A window's bars, like a macOS or iPadOS window: the top bar holds the
 * window pill, an optional title and the shown tab's toolbar; the bottom bar
 * holds the tab's secondary controls. Content runs underneath both.
 */
type Slot = "leading" | "title" | "top" | "bottom"

/**
 * Bar slots for tabs to fill: the top bar's by window (group id), shared by
 * its tabs; the bottom bar's by tab (panel id), since it sits in the tab.
 */
const useSlots = create<Record<string, HTMLElement | undefined>>()(() => ({}))

const key = (owner: string, slot: Slot) => `${owner}:${slot}`

/** Where the shown tab's title or controls land in a window's bars. */
export function WindowSlot({
  owner,
  slot,
  className,
  onElement,
}: {
  owner: string
  slot: Slot
  className?: string
  /** Hands the slot element to its window, which measures it. */
  onElement?: (element: HTMLDivElement | null) => void
}) {
  const ref = useCallback(
    (element: HTMLDivElement) => {
      const id = key(owner, slot)
      useSlots.setState({ [id]: element })
      onElement?.(element)
      return () => {
        if (useSlots.getState()[id] === element)
          useSlots.setState({ [id]: undefined })
        onElement?.(null)
      }
    },
    [owner, slot, onElement]
  )
  return <div className={className} data-window-slot={slot} ref={ref} />
}

/**
 * The slot this tab fills, and whether the tab is the one its window shows.
 * Every tab of a window keeps its controls in the window's bar, hidden while
 * another tab is shown, so switching tabs moves one set out and the next in.
 */
function useTabSlot(slot: Slot) {
  const panel = usePanel()?.panel
  useDock((state) => state.revision)
  const owner = slot === "bottom" ? panel?.id : panel?.group.id
  const element = useSlots((slots) =>
    owner ? slots[key(owner, slot)] : undefined
  )
  // Visibility is the tab's own event: a switch inside a window does not
  // always change the dock's layout facts.
  const shown = useSyncExternalStore(
    (change) => {
      const listener = panel?.api.onDidVisibilityChange(change)
      return () => listener?.dispose()
    },
    () => !!panel && panel.group.activePanel?.id === panel.id
  )
  return { element: panel ? element : undefined, shown }
}

/**
 * A tab's own toolbar controls, after Apple's toolbar sections: `leading`
 * sits after the window pill and before the title, `top` (trailing) at the
 * end of the top bar, `bottom` fills the window's bottom bar.
 */
export function WindowToolbar({
  placement = "top",
  className,
  children,
}: {
  placement?: "leading" | "top" | "bottom"
  className?: string
  children: ReactNode
}) {
  const { element, shown } = useTabSlot(placement)
  const group = usePanel()?.panel.group.id
  const overflow = useBarOverflow((bars) =>
    placement === "top" && group ? bars[group] : undefined
  )
  if (!element) return null
  return createPortal(
    <ToolbarHiddenContext.Provider value={!shown}>
      <OverflowContext.Provider value={overflow ?? null}>
        <ToolbarCluster
          edge={placement === "top" ? "end" : "start"}
          placement={placement === "bottom" ? "bottom" : "top"}
          className={cn("window-toolbar-cluster", className)}
          data-inactive={!shown || undefined}
        >
          {children}
        </ToolbarCluster>
      </OverflowContext.Provider>
    </ToolbarHiddenContext.Provider>,
    element
  )
}

/**
 * The tab's title in the window's top bar, after the leading controls: a
 * title line and an optional subtitle, each cut short with an ellipsis.
 * Plain text, not a control. Tabs' titles cross-fade as the tab changes.
 */
export function WindowTitle({
  title,
  subtitle,
  tooltip,
}: {
  title: ReactNode
  subtitle?: ReactNode
  tooltip?: string
}) {
  const { element, shown } = useTabSlot("title")
  if (!element) return null
  return createPortal(
    <div
      className="window-title"
      title={tooltip}
      data-inactive={!shown || undefined}
      aria-hidden={!shown || undefined}
    >
      <span className="window-title-main">{title}</span>
      {subtitle && <span className="window-title-sub">{subtitle}</span>}
    </div>,
    element
  )
}
