import { create } from "zustand"
import { toggleTray } from "@/features/dock/store"

type Request = { id: string; revision: number }
export type InputRequest = { taskId: string; role: string; sequence: number }

type LayoutState = {
  inspectorTab: string
  inputRequest: InputRequest | null
  revealedNode?: Request
  revealedConnection?: Request
  logRequest: Request | null
  /** Counts log requests, so the tray shows the log again for each. */
  logRevision: number
  setInspectorTab: (tab: string) => void
  requestInput: (taskId: string, role: string) => void
  clearInputRequest: () => void
  revealNode: (id: string) => void
  revealConnection: (id: string) => void
  /** Opens the run tray on a job's log. */
  viewLog: (id: string) => void
  clearLog: () => void
}

const next = (previous: Request | null | undefined, id: string) => ({
  id,
  revision: (previous?.revision || 0) + 1,
})

/**
 * Cross-window requests, kept apart from where each window sits so one
 * window can focus or reveal something in another.
 */
export const useLayout = create<LayoutState>()((set) => ({
  inspectorTab: "info",
  inputRequest: null,
  logRequest: null,
  logRevision: 0,
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
  viewLog: (id) => {
    set((state) => ({
      logRequest: next(state.logRequest, id),
      logRevision: state.logRevision + 1,
    }))
    toggleTray(true)
  },
  clearLog: () => set({ logRequest: null }),
}))
