import type { PanelId } from "./panels"
import { emptySnaps, setHidden, snap, type Size, type Snaps } from "./layout"

export type PresetId = "default" | "review"
export const PRESETS: { id: PresetId; label: string }[] = [
  { id: "default", label: "기본" },
  { id: "review", label: "결과 검토" },
]

const LIBRARY: PanelId[] = ["files", "runs", "tasks", "settings"]

/**
 * Builds a preset: `open` opens tabs together as one window and gives its
 * id; the preset snaps the windows it opened. A preset is only a starting
 * arrangement the user can undo by moving any window.
 */
export function buildPreset(
  preset: PresetId,
  open: (ids: PanelId[]) => string,
  workbench: Size
): Snaps {
  let snaps = emptySnaps()
  const library = open(LIBRARY)
  snaps = snap(snaps, library, "left")
  if (preset === "review") {
    snaps = snap(snaps, open(["inspector", "history"]), "right")
    snaps = { ...snaps, sizes: { ...snaps.sizes, right: 320 } }
    // Results take the main area; the workflow sits below them.
    const workflow = open(["workflow"])
    snaps = snap(snaps, workflow, "center")
    snaps = snap(snaps, open(["viewer"]), "center", {
      id: workflow,
      side: "top",
    })
    return snaps
  }
  snaps = snap(snaps, open(["workflow"]), "center")
  snaps = snap(snaps, open(["inspector"]), "right")
  snaps = snap(snaps, open(["history"]), "bottom")
  snaps = setHidden(snaps, "bottom", true)
  if (workbench.width < 1100) snaps = setHidden(snaps, "left", true)
  return snaps
}
