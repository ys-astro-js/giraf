import type { ComponentType } from "react"
import { Image, Monitor, PanelRight, Workflow, type LucideIcon } from "lucide-react"
import { WorkflowPanel } from "@/features/panels/WorkflowPanel"
import { InspectorPanel } from "@/features/panels/InspectorPanel"
import { ViewerPanel } from "@/features/viewer/ViewerPanel"
import { DisplayPanel } from "@/features/viewer/DisplayPanel"
import { KINDS, type Kind } from "./layout"

export type PanelId = "workflow" | "inspector" | "viewer" | "display"

export type PanelDefinition = {
  title: string
  icon: LucideIcon
  component: ComponentType
  /** Tabs gather only with tabs of the same kind (see layout.ts). */
  kind: Kind
  /** Follows the selection until the tab is locked. */
  follows?: boolean
  /** A canvas runs on under the window's bars instead of between them. */
  canvas?: boolean
}

/**
 * Every workbench window. Windows read shared state from the workbench
 * context and layout stores, so the dock can place them anywhere.
 */
export const PANELS: Record<PanelId, PanelDefinition> = {
  workflow: {
    title: "워크플로우",
    icon: Workflow,
    component: WorkflowPanel,
    kind: KINDS.workflow,
    canvas: true,
  },
  inspector: {
    title: "노드",
    icon: PanelRight,
    component: InspectorPanel,
    kind: KINDS.inspector,
    follows: true,
  },
  viewer: {
    title: "뷰어",
    icon: Image,
    component: ViewerPanel,
    kind: KINDS.viewer,
    canvas: true,
    follows: true,
  },
  display: {
    title: "IRAF 디스플레이",
    icon: Monitor,
    component: DisplayPanel,
    kind: KINDS.display,
    canvas: true,
  },
}
