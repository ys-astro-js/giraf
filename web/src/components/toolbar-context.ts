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
