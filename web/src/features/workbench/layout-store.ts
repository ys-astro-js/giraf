import { create } from "zustand"
import { toggleTray } from "@/features/dock/store"

type Request = { id: string; revision: number }
export type InputRequest = { taskId: string; role: string; sequence: number }
/** A parameter to open in the settings tab: `name` or `pset.name`. */
export type ParameterRequest = { taskId: string; key: string; sequence: number }

type LayoutState = {
  inspectorTab: string
  inputRequest: InputRequest | null
  parameterRequest: ParameterRequest | null
  revealedNode?: Request
  revealedConnection?: Request
  /** A new node to bring into view, panning only. */
  pannedNode?: Request
  /** The middle of the visible canvas, in canvas coordinates; set while the canvas shows. */
  visibleCenter?: () => { x: number; y: number } | undefined
  logRequest: Request | null
  /** Counts log requests, so the tray shows the log again for each. */
  logRevision: number
  setInspectorTab: (tab: string) => void
  requestInput: (taskId: string, role: string) => void
  requestParameter: (taskId: string, key: string) => void
  clearInputRequest: () => void
  revealNode: (id: string) => void
  revealConnection: (id: string) => void
  panToNode: (id: string) => void
  /** Opens the run tray on a job's log. */
  viewLog: (id: string) => void
  /** Selects a job's log in the run tray, leaving the tray open or closed. */
  selectLog: (id: string) => void
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
  parameterRequest: null,
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
  requestParameter: (taskId, key) =>
    set((state) => ({
      inspectorTab: "settings",
      parameterRequest: {
        taskId,
        key,
        sequence: (state.parameterRequest?.sequence || 0) + 1,
      },
    })),
  clearInputRequest: () => set({ inputRequest: null, parameterRequest: null }),
  revealNode: (id) =>
    set((state) => ({ revealedNode: next(state.revealedNode, id) })),
  revealConnection: (id) =>
    set((state) => ({
      revealedConnection: next(state.revealedConnection, id),
    })),
  panToNode: (id) =>
    set((state) => ({ pannedNode: next(state.pannedNode, id) })),
  viewLog: (id) => {
    useLayout.getState().selectLog(id)
    toggleTray(true)
  },
  selectLog: (id) =>
    set((state) => ({
      logRequest: next(state.logRequest, id),
      logRevision: state.logRevision + 1,
    })),
  clearLog: () => set({ logRequest: null }),
}))
