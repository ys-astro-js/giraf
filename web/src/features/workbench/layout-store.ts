import { create } from "zustand"
import { readPanelLayout, savePanelLayout } from "@/lib/panel-layout"

/** Panels that can be hidden; the workflow canvas always stays. */
export type ClosablePanel = "library" | "inspector" | "history" | "display"
type Request = { id: string; revision: number }
export type InputRequest = { taskId: string; role: string; sequence: number }

type LayoutState = {
  open: Record<ClosablePanel, boolean>
  inspectorTab: string
  inputRequest: InputRequest | null
  revealedNode?: Request
  revealedConnection?: Request
  logRequest: Request | null
  setOpen: (panel: ClosablePanel, open: boolean) => void
  setInspectorTab: (tab: string) => void
  requestInput: (taskId: string, role: string) => void
  clearInputRequest: () => void
  revealNode: (id: string) => void
  revealConnection: (id: string) => void
  viewLog: (id: string) => void
  clearLog: () => void
}

const next = (previous: Request | null | undefined, id: string) => ({
  id,
  revision: (previous?.revision || 0) + 1,
})

/**
 * Layout and cross-panel requests, kept apart from where each panel sits so
 * one panel can open, focus or reveal something in another.
 */
export const useLayout = create<LayoutState>()((set) => {
  const saved = readPanelLayout()
  return {
    open: {
      library:
        saved.libraryOpen ??
        (typeof window !== "undefined" && window.innerWidth >= 1100),
      inspector: saved.inspectorOpen ?? true,
      history: false,
      display: true,
    },
    inspectorTab: "info",
    inputRequest: null,
    logRequest: null,
    setOpen: (panel, open) => {
      if (panel === "library") savePanelLayout({ libraryOpen: open })
      if (panel === "inspector") savePanelLayout({ inspectorOpen: open })
      set((state) =>
        state.open[panel] === open
          ? state
          : { open: { ...state.open, [panel]: open } }
      )
    },
    setInspectorTab: (inspectorTab) => set({ inspectorTab }),
    requestInput: (taskId, role) =>
      set((state) => ({
        inspectorTab: "input",
        inputRequest: {
          taskId,
          role,
          sequence: (state.inputRequest?.sequence || 0) + 1,
        },
      })),
    clearInputRequest: () => set({ inputRequest: null }),
    revealNode: (id) =>
      set((state) => ({ revealedNode: next(state.revealedNode, id) })),
    revealConnection: (id) =>
      set((state) => ({
        revealedConnection: next(state.revealedConnection, id),
      })),
    viewLog: (id) =>
      set((state) => ({
        logRequest: next(state.logRequest, id),
        open: { ...state.open, history: true },
      })),
    clearLog: () =>
      set((state) => ({
        logRequest: null,
        open: { ...state.open, history: false },
      })),
  }
})

export const showPanel = (panel: ClosablePanel) =>
  useLayout.getState().setOpen(panel, true)
