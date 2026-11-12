import { useMemo, useSyncExternalStore } from "react"
import { diagnostics, fieldIssues } from "./diagnostics"
import type { Catalog, Spec } from "./workbench"

/** The node's current problems by field (diagnostics fieldIssues), kept current. */
export function useFieldIssues(nodeId: string) {
  const entries = useSyncExternalStore(diagnostics.subscribe, diagnostics.getSnapshot, diagnostics.getSnapshot)
  return useMemo(() => fieldIssues(entries, nodeId), [entries, nodeId])
}

/** The inspector tab a field is edited in: an input role in 입력, a file save's 저장 위치 in 출력, the rest in 설정. */
export function fieldTab(spec: Spec, catalog: Catalog, field: string): "input" | "output" | "settings" {
  const roles = [...spec.inputs, ...(spec.preprocess && spec.adapter !== "generic" ? catalog.ccdproc.inputs : [])]
  if (spec.run === "save-files" && field === "destination") return "output"
  return roles.some((slot) => slot.name === field) ? "input" : "settings"
}
