import { emptyMap, type Connection, type TaskMap } from "./task-map"
import type { Preferences } from "./workbench"

export function workflowDocument(prefs: Preferences, taskMap: TaskMap) {
  const graph = structuredClone(taskMap)
  const taskIds = new Set(graph.tasks.map(task => task.id))
  // Share the recipe, not this workspace's selected files or past executions.
  for (const task of graph.tasks) {
    task.instrument = []
    for (const draft of [task.draft, task.preprocess]) {
      draft.inputs = {}
      delete draft.alignmentBinding
    }
  }
  graph.connections = graph.connections.flatMap((connection): Connection[] => {
    const source = connection.source
    if (source.kind === "files" || !source.taskId || !taskIds.has(source.taskId)) return []
    const { taskId, outputRole, group, port, files } = source
    return [{ ...connection, source: { kind: "pending", taskId, outputRole, group, port, files } }]
  })
  graph.runs = []
  graph.view = { ...emptyMap().view, coordinateSystem: graph.view.coordinateSystem }
  return {
    format: "giraf-workflow",
    version: 1,
    name: prefs._document?.name || "워크플로우",
    taskMap: graph,
    // All settings needed by existing nodes are stored on the nodes themselves.
    preferences: {},
  }
}
