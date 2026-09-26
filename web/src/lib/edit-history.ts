import { createStore } from "zustand/vanilla"
import { shallow } from "zustand/shallow"
import { temporal, type ZundoOptions } from "zundo"
import {
  bindWorkflowOutputs,
  removeLibraryReferences,
  type Source,
  type TaskMap,
} from "./task-map"
import type { Catalog, Job } from "./workbench"

export type EditEntry = { label: string }
type EditableDocument = Pick<
  TaskMap,
  "version" | "tasks" | "connections" | "subflows" | "edgeRoutes"
> & {
  edgeStyle: TaskMap["view"]["edgeStyle"]
}
type Checkpoint = {
  document: EditableDocument
  selected: string
  label: string
}
type Run = Pick<Job, "id" | "state" | "products">
type Runtime = {
  runs: TaskMap["runs"]
  bindings: Map<string, { run: Run; catalog: Catalog; revision: number }>
  revision: number
  deletedFiles: Set<string>
  deletedJobs: Set<string>
}
type EditorState = Checkpoint & { runtime: Runtime; view: TaskMap["view"] }
type RecordCheckpoint = ReturnType<
  NonNullable<ZundoOptions<EditorState, Checkpoint>["handleSet"]>
>
const DEFAULT_HISTORY_LIMIT = 100

const documentFrom = (map: TaskMap): EditableDocument => ({
  version: map.version,
  tasks: map.tasks,
  connections: map.connections,
  subflows: map.subflows,
  edgeRoutes: map.edgeRoutes,
  edgeStyle: map.view.edgeStyle,
})
const initialState = (map: TaskMap): EditorState => ({
  document: documentFrom(map),
  selected: map.view.selected,
  label: "",
  view: map.view,
  runtime: {
    runs: map.runs,
    bindings: new Map(),
    revision: 0,
    deletedFiles: new Set(),
    deletedJobs: new Set(),
  },
})

// React Flow may rebuild arrays for selection or measurement alone.
function reuseRows<T>(
  before: T[] | undefined,
  after: T[] | undefined
): T[] | undefined {
  return before &&
    after &&
    before.length === after.length &&
    before.every((row, i) => shallow(row, after[i]))
    ? before
    : after
}

export function createEditorStore(
  initial: TaskMap,
  { historyLimit = DEFAULT_HISTORY_LIMIT } = {}
) {
  let grouping = false
  let recorded = false
  // A result explicitly selected after a run must not be overwritten by that older run.
  // Weak keys let evicted checkpoints release their source objects.
  let sourceRevisions = new WeakMap<Source, number>()
  const store = createStore<EditorState>()(
    temporal(() => initialState(initial), {
      partialize: ({ document, selected, label }): Checkpoint => ({
        document,
        selected,
        label,
      }),
      equality: (before, after) => before.document === after.document,
      limit: historyLimit,
      handleSet:
        (record) =>
        (...args) => {
          if (grouping && recorded) return
          // zundo types its callback as setState, but passes the four checkpoint arguments.
          ;(record as RecordCheckpoint)(...args)
          if (grouping) recorded = true
        },
    })
  )
  let cachedState: EditorState | undefined
  let cachedMap: TaskMap
  let projectedDocument: EditableDocument | undefined
  let projectedRuntime: Runtime | undefined
  let projected: TaskMap

  const selectMap = (state: EditorState): TaskMap => {
    if (state === cachedState) return cachedMap
    if (
      state.document !== projectedDocument ||
      state.runtime !== projectedRuntime
    ) {
      const { version, tasks, connections, subflows, edgeRoutes } =
        state.document
      projected = {
        version,
        tasks,
        connections,
        subflows,
        edgeRoutes,
        runs: state.runtime.runs,
        view: state.view,
      }
      for (const [instanceId, binding] of state.runtime.bindings) {
        projected = bindWorkflowOutputs(
          projected,
          instanceId,
          binding.run,
          binding.catalog,
          (source) => (sourceRevisions.get(source) ?? -1) < binding.revision
        )
      }
      if (state.runtime.deletedFiles.size || state.runtime.deletedJobs.size) {
        projected = removeLibraryReferences(
          projected,
          state.runtime.deletedFiles,
          state.runtime.deletedJobs
        )
      }
      projectedDocument = state.document
      projectedRuntime = state.runtime
    }
    cachedState = state
    cachedMap = {
      ...projected,
      view: {
        ...state.view,
        selected: state.selected,
        edgeStyle: state.document.edgeStyle,
      },
    }
    return cachedMap
  }
  const getMap = () => selectMap(store.getState())
  const endEdit = () => {
    grouping = false
    recorded = false
  }

  return {
    store,
    selectMap,
    getMap,
    beginEdit: () => {
      if (!grouping) {
        grouping = true
        recorded = false
      }
    },
    endEdit,
    update: (change: (map: TaskMap) => TaskMap, label = "워크플로우 변경") => {
      const state = store.getState()
      const before = getMap()
      const after = change(before)
      if (after === before) return false
      // Keep execution-derived connections and library filtering out of checkpoints.
      const unproject = <T extends { id: string }>(
        next: T[],
        displayed: T[],
        raw: T[]
      ) => {
        if (next === displayed) return raw
        const displayedById = new Map(displayed.map((row) => [row.id, row]))
        const rawById = new Map(raw.map((row) => [row.id, row]))
        return next.map((row) =>
          row === displayedById.get(row.id) ? (rawById.get(row.id) ?? row) : row
        )
      }
      const nextDocument = documentFrom(after)
      nextDocument.tasks = reuseRows(
        state.document.tasks,
        unproject(after.tasks, before.tasks, state.document.tasks)
      )!
      nextDocument.connections = reuseRows(
        state.document.connections,
        unproject(
          after.connections,
          before.connections,
          state.document.connections
        )
      )!
      nextDocument.subflows = reuseRows(state.document.subflows, after.subflows)
      const document = shallow(state.document, nextDocument)
        ? state.document
        : nextDocument
      const view = shallow(state.view, after.view) ? state.view : after.view
      if (
        document === state.document &&
        view === state.view &&
        state.selected === after.view.selected
      )
        return false
      if (document.connections !== state.document.connections) {
        const oldSources = new Set(
          state.document.connections.map((link) => link.source)
        )
        for (const link of document.connections) {
          if (!oldSources.has(link.source))
            sourceRevisions.set(link.source, state.runtime.revision)
        }
      }
      store.setState({
        document,
        view,
        selected: after.view.selected,
        label: document === state.document ? state.label : label,
      })
      return true
    },
    publishRun: (instanceId: string, run: Run, catalog?: Catalog) => {
      const { runtime } = store.getState()
      const previous = runtime.runs.find((record) => record.id === run.id)
      const binding = runtime.bindings.get(instanceId)
      const bind = catalog && run.state === "completed"
      if (
        previous?.state === run.state &&
        previous.products === run.products &&
        (!bind || binding?.run === run)
      )
        return false
      const record = {
        id: run.id,
        state: run.state,
        products: run.products,
        instanceId,
      }
      const runs = previous
        ? runtime.runs.map((value) => (value.id === run.id ? record : value))
        : [...runtime.runs, record]
      const bindings = new Map(runtime.bindings)
      const revision = runtime.revision + 1
      if (catalog && run.state === "completed")
        bindings.set(instanceId, { run, catalog, revision })
      store.setState({ runtime: { ...runtime, runs, bindings, revision } })
      return true
    },
    removeLibrary: (files: Set<string>, jobs: Set<string>) => {
      const { runtime } = store.getState()
      const deletedFiles = new Set([...runtime.deletedFiles, ...files])
      for (const run of runtime.runs)
        if (jobs.has(run.id))
          for (const product of run.products) deletedFiles.add(product.id)
      store.setState({
        runtime: {
          ...runtime,
          deletedFiles,
          deletedJobs: new Set([...runtime.deletedJobs, ...jobs]),
        },
      })
    },
    reset: (map: TaskMap) => {
      endEdit()
      sourceRevisions = new WeakMap()
      store.temporal.getState().pause()
      store.setState(initialState(map))
      store.temporal.getState().clear()
      store.temporal.getState().resume()
    },
    undo: (steps = 1) => {
      endEdit()
      const history = store.temporal.getState()
      const count = Math.min(history.pastStates.length, Math.trunc(steps))
      if (!Number.isFinite(count) || count < 1) return false
      history.undo(count)
      return true
    },
    redo: (steps = 1) => {
      endEdit()
      const history = store.temporal.getState()
      const count = Math.min(history.futureStates.length, Math.trunc(steps))
      if (!Number.isFinite(count) || count < 1) return false
      history.redo(count)
      return true
    },
    history: (
      history = store.temporal.getState(),
      label = store.getState().label
    ): { past: EditEntry[]; future: EditEntry[] } => {
      const { pastStates, futureStates } = history
      return {
        past: pastStates.map((_, i) => ({
          label: pastStates[i + 1]?.label ?? label,
        })),
        future: futureStates.map((state) => ({
          label: state.label ?? "워크플로우 변경",
        })),
      }
    },
  }
}
