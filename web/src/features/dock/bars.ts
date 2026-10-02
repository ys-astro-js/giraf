import { create } from "zustand"
import type { OverflowRegistry } from "@/components/toolbar-context"

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
