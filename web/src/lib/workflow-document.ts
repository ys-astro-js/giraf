import type { TaskMap } from "./task-map"
import type { Preferences } from "./workbench"

export function workflowDocument(prefs: Preferences, taskMap: TaskMap) {
  // API preferences also carry a saved graph and a workspace file cache.
  // Export only settings here; the current graph is stored once at the top level.
  const { drafts, backend, mapping, instrument, packageValues, parameterSets } = prefs
  return {
    format: "giraf-workflow",
    version: 1,
    name: prefs._document?.name || "워크플로우",
    taskMap,
    preferences: { drafts, backend, mapping, instrument, packageValues, parameterSets },
  }
}
