import type { DockviewApi, DockviewGroupPanel } from "dockview-react"

/**
 * Windows along a side keep the size they were given, the width of a left
 * or right window and the height of a bottom one, while the workbench
 * changes size; the workflow's area takes up the difference. dockview
 * instead scales every window by its share of the workbench and saves the
 * shares again on every change, so a sidebar widens with the browser
 * window, and a change made while windows are squeezed to their minimums
 * leaves them distorted for good.
 */
export type KeptSize = { width?: number; height?: number }

const kept = new Map<string, KeptSize>()

/** The sizes to save with the layout, by group id. */
export const keptSizes = () => Object.fromEntries(kept)

export function setKeptSizes(sizes: Record<string, KeptSize> = {}) {
  kept.clear()
  for (const [id, size] of Object.entries(sizes)) kept.set(id, size)
}

/**
 * Records the sizes the side windows have now, as the user or a layout
 * change left them. Windows hidden with their side keep what they had.
 */
export function keepSizes(
  dock: DockviewApi,
  sides: { across: DockviewGroupPanel[]; along: DockviewGroupPanel[] }
) {
  const ids = new Set(dock.groups.map((group) => group.id))
  for (const id of kept.keys()) if (!ids.has(id)) kept.delete(id)
  for (const group of sides.across)
    if (group.width) kept.set(group.id, { width: Math.round(group.width) })
  for (const group of sides.along)
    if (group.height) kept.set(group.id, { height: Math.round(group.height) })
}

/**
 * Gives the side windows back their kept sizes, after the workbench
 * resized or dockview rebuilt the layout around a moved window (`moved`,
 * which takes its new size instead).
 */
export function restoreSizes(dock: DockviewApi, moved?: DockviewGroupPanel) {
  for (const [id, size] of kept) {
    if (id === moved?.id) continue
    const group = dock.getGroup(id) as DockviewGroupPanel | undefined
    if (!group || group.api.location.type !== "grid") continue
    if (!group.width || !group.height) continue
    if (size.width && Math.abs(group.width - size.width) > 1)
      group.api.setSize({ width: size.width })
    if (size.height && Math.abs(group.height - size.height) > 1)
      group.api.setSize({ height: size.height })
  }
}
