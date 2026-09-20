export type PanelLayout = {
  libraryWidth?: number
  inspectorWidth?: number
  libraryOpen?: boolean
  inspectorOpen?: boolean
}
export const SIDEBAR_MAX_WIDTH = 480

const storageKey = "giraf-panel-layout"
type Reader = Pick<Storage, "getItem">
type Writer = Pick<Storage, "getItem" | "setItem">

export function readPanelLayout(storage?: Reader): PanelLayout {
  try {
    const value = JSON.parse(
      (storage ?? localStorage).getItem(storageKey) || "{}"
    )
    const layout: PanelLayout = {}
    for (const key of ["libraryWidth", "inspectorWidth"] as const) {
      if (
        typeof value?.[key] === "number" &&
        Number.isFinite(value[key]) &&
        value[key] > 0
      )
        layout[key] = Math.min(value[key], SIDEBAR_MAX_WIDTH)
    }
    for (const key of ["libraryOpen", "inspectorOpen"] as const) {
      if (typeof value?.[key] === "boolean") layout[key] = value[key]
    }
    return layout
  } catch {
    return {}
  }
}

export function savePanelLayout(patch: PanelLayout, storage?: Writer) {
  try {
    const target = storage ?? localStorage
    target.setItem(
      storageKey,
      JSON.stringify({ ...readPanelLayout(target), ...patch })
    )
  } catch {
    // Resizing remains usable when browser storage is unavailable.
  }
}
