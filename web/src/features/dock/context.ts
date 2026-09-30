import { createContext, useContext } from "react"
import type { IDockviewPanel } from "dockview-react"
import type { WindowParams } from "./store"

export type PanelContextValue = {
  panel: IDockviewPanel
  params: WindowParams
  /**
   * Whether the tab shows rich content (a canvas, an image) that runs under
   * clear bars, or text read between translucent ones. Tabs whose content
   * changes kind (the viewer) set it; others keep their panel's default.
   */
  setCanvas: (canvas: boolean) => void
}

export const PanelContext = createContext<PanelContextValue | null>(null)

/** The dock window this content is rendered in, if any. */
export const usePanel = () => useContext(PanelContext)
