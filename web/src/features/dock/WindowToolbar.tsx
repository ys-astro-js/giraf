import { useCallback, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { create } from "zustand"
import { ToolbarCluster } from "@/components/toolbar"
import { usePanel } from "./context"
import { useDock } from "./store"

/** Each window's toolbar row, by group id, for its tabs to fill. */
const useSlots = create<Record<string, HTMLElement | undefined>>()(() => ({}))

/** Where the shown tab's controls land in a window's toolbar row. */
export function WindowToolbarSlot({ group }: { group: string }) {
  const ref = useCallback(
    (element: HTMLDivElement) => {
      useSlots.setState({ [group]: element })
      return () => {
        if (useSlots.getState()[group] === element)
          useSlots.setState({ [group]: undefined })
      }
    },
    [group]
  )
  return <div className="window-toolbar-slot" ref={ref} />
}

/**
 * A tab's own controls, shown in its window's toolbar row while the tab is
 * the one shown. Each tab brings different ones.
 */
export function WindowToolbar({ children }: { children: ReactNode }) {
  const panel = usePanel()?.panel
  useDock((state) => state.revision)
  const slot = useSlots((slots) => (panel ? slots[panel.group.id] : undefined))
  if (!panel || !slot || panel.group.activePanel?.id !== panel.id) return null
  return createPortal(
    <ToolbarCluster edge="end" size="sm">
      {children}
    </ToolbarCluster>,
    slot
  )
}
