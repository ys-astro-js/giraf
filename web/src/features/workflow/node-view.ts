import { create } from "zustand"

/** Below this zoom the canvas draws every node collapsed, without saving it. */
export const AUTO_COLLAPSE_ZOOM = 0.6
const key = "giraf.autoCollapseNodes"

function stored() {
  try {
    return localStorage.getItem(key) !== "false"
  } catch {
    return true
  }
}

type NodeViewState = {
  autoCollapse: boolean
  setAutoCollapse: (value: boolean) => void
}

/** A viewer preference, not workflow content: it never enters the document. */
export const useNodeView = create<NodeViewState>()((set) => ({
  autoCollapse: stored(),
  setAutoCollapse: (autoCollapse) => {
    try {
      localStorage.setItem(key, String(autoCollapse))
    } catch {
      // Private windows may refuse storage; the setting still applies now.
    }
    set({ autoCollapse })
  },
}))
