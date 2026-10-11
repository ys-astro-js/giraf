import { useMemo, useSyncExternalStore } from "react"
import { diagnostics, fieldIssues } from "./diagnostics"
import type { Catalog, Spec } from "./workbench"

/** The node's current problems by field (diagnostics fieldIssues), kept current. */
export function useFieldIssues(nodeId: string) {
  const entries = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot, diagnostics.getSnapshot)
  return useMemo(() => fieldIssues(entries, nodeId), [entries, nodeId])
}

/** The inspector tab a field is edited in: an input role in 입력, the rest in 설정. */
export function fieldTab(spec: Spec, catalog: Catalog, field: string): "input" | "settings" {
  const roles = [...spec.inputs, ...(spec.preprocess && spec.adapter !== "generic" ? catalog.ccdproc.inputs : [])]
  return roles.some((slot) => slot.name === field) ? "input" : "settings"
}
