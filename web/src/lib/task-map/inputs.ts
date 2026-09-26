import { resolvedSource } from "./runs"
import type { TaskMap, Instance } from "./model"

export function assigned(
  map: TaskMap,
  t: Instance,
  role: string
): { ids: string[]; pending: string[] } {
  const links = map.connections
    .filter(
      (c) =>
        c.target === t.id &&
        c.role === role &&
        (c.source.kind !== "files" || c.source.ids.length > 0)
    )
    .map((c) => ({ ...c, source: resolvedSource(map, c.source) }))
  return {
    ids: links.length
      ? links.flatMap((c) => (c.source.kind === "pending" ? [] : c.source.ids))
      : t.draft.inputs[role] || t.preprocess.inputs[role] || [],
    pending: links.flatMap((c) =>
      c.source.kind === "pending" ? [c.source.taskId] : []
    ),
  }
}
