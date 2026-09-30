import type { ComponentType } from "react"
import {
  Clock,
  FolderClosed,
  History,
  PanelRight,
  SlidersHorizontal,
  SquareFunction,
  Workflow,
  type LucideIcon,
} from "lucide-react"
import { FilesPanel } from "@/features/library/FilesPanel"
import { RunsPanel } from "@/features/library/RunsPanel"
import { TasksPanel } from "@/features/library/TasksPanel"
import { SettingsPanel } from "@/features/library/SettingsPanel"
import { WorkflowPanel } from "@/features/panels/WorkflowPanel"
import { InspectorPanel } from "@/features/panels/InspectorPanel"
import { HistoryPanel } from "@/features/panels/HistoryPanel"

export type PanelId =
  "files" | "runs" | "tasks" | "settings" | "workflow" | "inspector" | "history"

export type PanelDefinition = {
  title: string
  icon: LucideIcon
  component: ComponentType
  /** Where the window opens when it is not in the layout. */
  home: "left" | "right" | "bottom" | "center"
  /** Library windows share the sidebar surface. */
  surface?: "sidebar"
  /** Follows the selection until the window is locked. */
  follows?: boolean
}

/**
 * Every workbench window. Windows read shared state from the workbench
 * context and layout stores, so the dock can place them anywhere.
 */
export const PANELS: Record<PanelId, PanelDefinition> = {
  files: {
    title: "파일",
    icon: FolderClosed,
    component: FilesPanel,
    home: "left",
    surface: "sidebar",
  },
  runs: {
    title: "실행 기록",
    icon: Clock,
    component: RunsPanel,
    home: "left",
    surface: "sidebar",
  },
  tasks: {
    title: "작업",
    icon: SquareFunction,
    component: TasksPanel,
    home: "left",
    surface: "sidebar",
  },
  settings: {
    title: "설정",
    icon: SlidersHorizontal,
    component: SettingsPanel,
    home: "left",
    surface: "sidebar",
  },
  workflow: {
    title: "워크플로우",
    icon: Workflow,
    component: WorkflowPanel,
    home: "center",
  },
  inspector: {
    title: "노드",
    icon: PanelRight,
    component: InspectorPanel,
    home: "right",
    follows: true,
  },
  history: {
    title: "실행 기록",
    icon: History,
    component: HistoryPanel,
    home: "bottom",
  },
}
