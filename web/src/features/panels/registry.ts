import type { ComponentType } from "react"
import { LibraryPanel } from "./LibraryPanel"
import { WorkflowPanel } from "./WorkflowPanel"
import { InspectorPanel } from "./InspectorPanel"
import { HistoryPanel } from "./HistoryPanel"

export type PanelId = "library" | "workflow" | "inspector" | "history"
export type PanelDefinition = { title: string; component: ComponentType }

/**
 * Every workbench panel. Panels read shared state from the workbench context
 * and layout store, so the shell can place them anywhere.
 */
export const PANELS: Record<PanelId, PanelDefinition> = {
  library: { title: "라이브러리", component: LibraryPanel },
  workflow: { title: "워크플로우", component: WorkflowPanel },
  inspector: { title: "설정", component: InspectorPanel },
  history: { title: "실행 기록", component: HistoryPanel },
}
