import { createContext, useContext } from "react"

export type ToolbarEdge = "start" | "end"
export type ToolbarPlacement = "top" | "bottom"
export type ToolbarSize = "default" | "sm"

export const ToolbarContext = createContext<{
  edge: ToolbarEdge
  placement: ToolbarPlacement
  size: ToolbarSize
}>({ edge: "start", placement: "top", size: "default" })

export function useToolbarButtonSize() {
  return useContext(ToolbarContext).size === "sm" ? "icon-sm" : "icon"
}

/** A button that can move into its cluster's overflow menu. */
export type OverflowEntry = {
  label: string
  icon: import("react").ReactNode
  onClick?: () => void
  disabled?: boolean
  pressed?: boolean
}

/**
 * A cluster that sends its less important groups to a menu when space runs
 * short. Groups and buttons register what the menu would show.
 */
export type OverflowRegistry = {
  collapsed: boolean
  /** Lists (or with null, unlists) one button under a stable key. */
  set: (key: string, entry: OverflowEntry | null) => void
}
export const OverflowContext = createContext<OverflowRegistry | null>(null)

/** The overflow group a button belongs to, and whether it is shown. */
export const OverflowGroupContext = createContext<{
  id: string
  shown: boolean
} | null>(null)

/**
 * Hides every group below it with the groups' own leaving motion, e.g. a
 * window's toolbar for a tab that is not shown, so switching tabs moves one
 * set of controls out and the next in, as the app's top bar does.
 */
export const ToolbarHiddenContext = createContext(false)

/** Lets a prominent button mark its group, which then keeps apart. */
export const ProminentContext = createContext<
  ((prominent: boolean) => void) | null
>(null)
