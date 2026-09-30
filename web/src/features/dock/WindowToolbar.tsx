import { useCallback, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { create } from "zustand"
import { ToolbarCluster } from "@/components/toolbar"
import { OverflowContext } from "@/components/toolbar-context"
import { useBarOverflow } from "./bars"
import { cn } from "@/lib/utils"
import { usePanel } from "./context"
import { useDock } from "./store"

/**
 * A window's bars, like a macOS or iPadOS window: the top bar holds the
 * window pill, an optional title and the shown tab's toolbar; the bottom bar
 * holds the tab's secondary controls. Content runs underneath both.
 */
type Slot = "title" | "top" | "bottom"

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

/** The slot this tab fills while it is the one its window shows. */
function useShownSlot(slot: Slot) {
  const panel = usePanel()?.panel
  useDock((state) => state.revision)
  const owner = slot === "bottom" ? panel?.id : panel?.group.id
  const element = useSlots((slots) =>
    owner ? slots[key(owner, slot)] : undefined
  )
  if (!panel || panel.group.activePanel?.id !== panel.id) return
  return element
}

/**
 * A tab's own toolbar controls. At the top they sit at the trailing end of
 * the window's top bar; at the bottom they fill the window's bottom bar.
 */
export function WindowToolbar({
  placement = "top",
  className,
  children,
}: {
  placement?: "top" | "bottom"
  className?: string
  children: ReactNode
}) {
  const slot = useShownSlot(placement)
  const group = usePanel()?.panel.group.id
  const overflow = useBarOverflow((bars) =>
    placement === "top" && group ? bars[group] : undefined
  )
  if (!slot) return null
  return createPortal(
    <OverflowContext.Provider value={overflow ?? null}>
      <ToolbarCluster
        edge={placement === "top" ? "end" : "start"}
        placement={placement}
        className={cn("window-toolbar-cluster", className)}
      >
        {children}
      </ToolbarCluster>
    </OverflowContext.Provider>,
    slot
  )
}

/**
 * The tab's title in the window's top bar: a title line and an optional
 * subtitle, each cut short with an ellipsis. Plain text, not a control.
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
  const slot = useShownSlot("title")
  if (!slot) return null
  return createPortal(
    <div className="window-title" title={tooltip}>
      <span className="window-title-main">{title}</span>
      {subtitle && <span className="window-title-sub">{subtitle}</span>}
    </div>,
    slot
  )
}
