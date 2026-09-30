import type { DockviewApi } from "dockview-react"
import { PANELS, type PanelId } from "./panels"
import { showEdge } from "./store"

export type PresetId = "default" | "review"
export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "default", label: "기본" },
  { id: "review", label: "결과 검토" },
]

const LIBRARY: PanelId[] = ["files", "runs", "tasks", "settings"]

function addTo(dock: DockviewApi, group: string, ids: PanelId[]) {
  for (const id of ids)
    dock.addPanel({
      id,
      component: id,
      title: PANELS[id].title,
      position: { referenceGroup: group },
    })
  dock.getPanel(ids[0])?.api.setActive()
}

type EdgeOptions = Parameters<DockviewApi["addEdgeGroup"]>[1]

/**
 * The edge group at a position, emptied for reuse. Edge groups are reused
 * rather than removed: removing one and adding another with the same id
 * leaves dockview rendering into the disposed group's header.
 */
function edge(
  dock: DockviewApi,
  position: "left" | "right" | "bottom",
  options: EdgeOptions
) {
  const existing = dock.getEdgeGroup(position)
  if (!existing) return dock.addEdgeGroup(position, options).id
  for (const panel of [...(dock.getGroup(existing.id)?.panels ?? [])])
    panel.api.close()
  existing.setSize(
    position === "bottom"
      ? { height: options.initialSize }
      : { width: options.initialSize }
  )
  showEdge(dock, position)
  return existing.id
}

/** Builds a preset into a dock without windows. */
export function buildPreset(dock: DockviewApi, preset: PresetId) {
  // The workflow goes in first so it owns the central grid.
  dock.addPanel({
    id: "workflow",
    component: "workflow",
    title: PANELS.workflow.title,
  })
  const left = edge(dock, "left", {
    id: "edge-left",
    initialSize: 256,
    minimumSize: 180,
    maximumSize: 480,
  })
  const right = edge(dock, "right", {
    id: "edge-right",
    initialSize: preset === "review" ? 320 : 384,
    minimumSize: 300,
    maximumSize: 480,
  })
  const bottom = edge(dock, "bottom", {
    id: "edge-bottom",
    initialSize: 240,
    minimumSize: 160,
  })
  addTo(dock, left, LIBRARY)
  if (preset === "review") addTo(dock, right, ["inspector", "history"])
  else {
    addTo(dock, right, ["inspector"])
    addTo(dock, bottom, ["history"])
  }
  // Visibility last: emptying the edges above hid them along the way.
  showEdge(dock, "left")
  if (preset === "default" && window.innerWidth < 1100)
    dock.setEdgeGroupVisible("left", false)
  showEdge(dock, "right")
  dock.setEdgeGroupVisible("bottom", false)
  dock.getPanel("workflow")?.api.setActive()
}
