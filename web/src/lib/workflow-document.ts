import { emptyMap, type Connection, type TaskMap } from "@/lib/task-map"
import type { Preferences } from "./workbench"

export function workflowDocument(prefs: Preferences, taskMap: TaskMap) {
  const graph = structuredClone(taskMap)
  const taskIds = new Set(graph.tasks.map(task => task.id))
  // Share the recipe, not this workspace's selected files or past executions.
  for (const task of graph.tasks) {
    task.instrument = []
    // Derived from the files a file node held here.
    delete task.passed
    for (const draft of [task.draft, task.preprocess]) {
      draft.inputs = {}
      delete draft.alignmentBinding
    }
    // A folder outside the project belongs to this device; relative ones travel.
    if (task.draft.destination?.path.startsWith("/")) task.draft.destination.path = ""
  }
  graph.connections = graph.connections.flatMap((connection): Connection[] => {
    const source = connection.source
    if (source.kind === "files" || !source.taskId || !taskIds.has(source.taskId)) return []
    const { taskId, outputRole, group, port, files, partition } = source
    return [{ ...connection, source: { kind: "pending", taskId, outputRole, group, port, files, partition } }]
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
