import type { DockviewApi, DockviewGroupPanel } from "dockview-react"
import { PANELS, type PanelId } from "./panels"
import { hideSide } from "./store"

export type PresetId = "default" | "review"
export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "default", label: "기본" },
  { id: "review", label: "결과 검토" },
]

const LIBRARY: PanelId[] = ["files", "runs", "tasks", "settings"]

type Position = NonNullable<Parameters<DockviewApi["addPanel"]>[0]["position"]>

type Size = { width: number } | { height: number }

/**
 * Opens tabs together in one new window at a position. Its size applies
 * once every window is in, since each addition shares out the space again.
 */
function addWindow(
  dock: DockviewApi,
  sizes: [DockviewGroupPanel, Size][],
  ids: PanelId[],
  position: Position,
  size: Size
) {
  const [first, ...rest] = ids
  const panel = dock.addPanel({
    id: first,
    component: first,
    title: PANELS[first].title,
    position,
  })
  sizes.push([panel.group, size])
  for (const id of rest)
    dock.addPanel({
      id,
      component: id,
      title: PANELS[id].title,
      position: { referenceGroup: panel.group },
    })
  panel.api.setActive()
  return panel.group
}

/** Builds a preset into a dock without windows. */
export function buildPreset(dock: DockviewApi, preset: PresetId) {
  dock.addPanel({
    id: "workflow",
    component: "workflow",
    title: PANELS.workflow.title,
  })
  const sizes: [DockviewGroupPanel, Size][] = []
  const library = addWindow(
    dock,
    sizes,
    LIBRARY,
    { direction: "left" },
    {
      width: 256,
    }
  )
  let history: DockviewGroupPanel | undefined
  if (preset === "review") {
    addWindow(
      dock,
      sizes,
      ["inspector", "history"],
      { direction: "right" },
      {
        width: 320,
      }
    )
    // Results take the main area; the workflow drops below them.
    dock.addPanel({
      id: "viewer",
      component: "viewer",
      title: PANELS.viewer.title,
      position: { referencePanel: "workflow", direction: "above" },
      initialHeight: 520,
    })
  } else {
    addWindow(
      dock,
      sizes,
      ["inspector"],
      { direction: "right" },
      {
        width: 384,
      }
    )
    history = addWindow(
      dock,
      sizes,
      ["history"],
      { referencePanel: "workflow", direction: "below" },
      { height: 240 }
    )
  }
  for (const [group, size] of sizes) group.api.setSize(size)
  if (history) hideSide("bottom", [history])
  if (preset === "default" && window.innerWidth < 1100)
    hideSide("left", [library])
  dock.getPanel("workflow")?.api.setActive()
}
