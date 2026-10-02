import { create } from "zustand"
import type { IDockviewPanel } from "dockview-react"
import type { OverflowRegistry } from "@/components/toolbar-context"
import { CANVAS } from "./layout"

/** Each window's top bar overflow, by group id, for its tabs' toolbars. */
export const useBarOverflow = create<Record<string, OverflowRegistry>>()(
  () => ({})
)

/** A place in a window's bars that tabs fill with controls. */
export type Slot = "pill" | "leading" | "title" | "top" | "bottom"

/**
 * Bar slots for tabs to fill: a window's top bar slots by group id, shared by
 * its tabs; the bottom bar's by tab (panel id), since it sits in the tab.
 */
export const useSlots = create<Record<string, HTMLElement | undefined>>()(
  () => ({})
)

export const slotKey = (owner: string, slot: Slot) => `${owner}:${slot}`

/**
 * Who owns a tab's top bar slots: its window (group), shared by its tabs;
 * the canvas has a bar of its own instead of its group's header.
 */
export const barOwner = (panel: IDockviewPanel) =>
  panel.id === CANVAS ? CANVAS : panel.group.id
