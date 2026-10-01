/*
 * Where snapped windows sit, as desktop systems tile them. Every window is
 * a free (floating) window; snapping one only gives it a box from this
 * model. The workbench has four regions: a column along the left edge and
 * one along the right, a row along the bottom between them, and the center
 * that is left. Each side keeps the size it was given in pixels, so the
 * center alone takes up the workbench changing size. Windows in one region
 * share it in fractions: the side columns stack, the bottom row lines up,
 * the center splits along one axis.
 *
 * Pure geometry: the dock applies the boxes (see store.ts), and a drop
 * preview asks for the same boxes a drop would give, so the two never
 * differ.
 */

export type Edge = "left" | "right" | "bottom"
export type Region = Edge | "center"
export type Side = "left" | "right" | "top" | "bottom"
export type Box = { left: number; top: number; width: number; height: number }
export type Size = { width: number; height: number }

export type Snaps = {
  /** Window (group) ids in each region, in order. */
  regions: Record<Region, string[]>
  /** Each window's share of its region, matching `regions`. */
  fractions: Record<Region, number[]>
  /** The side regions' own sizes: column widths, the bottom row's height. */
  sizes: Record<Edge, number>
  /** How the center splits when it holds several windows. */
  axis: "row" | "column"
  /** Sides whose windows a toolbar toggle has hidden. */
  hidden: Record<Edge, boolean>
  /**
   * Sides whose windows all left: their space stays desktop, so nothing
   * else grows into it, until a window snaps there or fills the center.
   */
  held: Record<Edge, boolean>
}

export const EDGES: Edge[] = ["left", "right", "bottom"]
const REGIONS: Region[] = ["left", "right", "bottom", "center"]

/** Sizes a side takes when its first window snaps there. */
export const SIDE_SIZE: Record<Edge, number> = {
  left: 256,
  right: 384,
  bottom: 240,
}
/** The center never shrinks below this, nor a side's window below MIN. */
const MIN_CENTER: Size = { width: 240, height: 160 }
const MIN: Size = { width: 160, height: 96 }

export function emptySnaps(): Snaps {
  return {
    regions: { left: [], right: [], bottom: [], center: [] },
    fractions: { left: [], right: [], bottom: [], center: [] },
    sizes: { ...SIDE_SIZE },
    axis: "row",
    hidden: { left: false, right: false, bottom: false },
    held: { left: false, right: false, bottom: false },
  }
}

export function regionOf(snaps: Snaps, id: string): Region | undefined {
  return REGIONS.find((region) => snaps.regions[region].includes(id))
}

/** The direction windows in a region line up along. */
function axisOf(snaps: Snaps, region: Region) {
  if (region === "center") return snaps.axis
  return region === "bottom" ? "row" : "column"
}

/** The sides a window can take another one beside it, within its region. */
export function sidesBeside(snaps: Snaps, id: string): Side[] {
  const region = regionOf(snaps, id)
  if (!region) return []
  if (region === "center" && snaps.regions.center.length === 1)
    return ["left", "right", "top", "bottom"]
  return axisOf(snaps, region) === "row" ? ["left", "right"] : ["top", "bottom"]
}

const copy = (snaps: Snaps): Snaps => ({
  regions: {
    left: [...snaps.regions.left],
    right: [...snaps.regions.right],
    bottom: [...snaps.regions.bottom],
    center: [...snaps.regions.center],
  },
  fractions: {
    left: [...snaps.fractions.left],
    right: [...snaps.fractions.right],
    bottom: [...snaps.fractions.bottom],
    center: [...snaps.fractions.center],
  },
  sizes: { ...snaps.sizes },
  axis: snaps.axis,
  hidden: { ...snaps.hidden },
  held: { ...snaps.held },
})

/**
 * Takes a window out of the model; the rest keep their shares, and a side
 * left empty keeps its space as desktop (see `held`).
 */
export function unsnap(snaps: Snaps, id: string): Snaps {
  const region = regionOf(snaps, id)
  if (!region) return snaps
  const next = copy(snaps)
  const index = next.regions[region].indexOf(id)
  const [share] = next.fractions[region].splice(index, 1)
  next.regions[region].splice(index, 1)
  if (region !== "center" && !next.regions[region].length)
    next.held[region] = !next.hidden[region]
  // The neighbor that touched it takes its share, as in a split pane.
  const fractions = next.fractions[region]
  if (fractions.length) fractions[Math.max(0, index - 1)] += share
  return next
}

/**
 * Puts a window in a region: at its end, or beside a window already there
 * (taking half of that window's share). A side's first window shows it.
 */
export function snap(
  snaps: Snaps,
  id: string,
  region: Region,
  beside?: { id: string; side: Side }
): Snaps {
  const next = unsnap(snaps, id)
  const ids = next.regions[region]
  const fractions = next.fractions[region]
  if (region !== "center") {
    next.hidden[region] = false
    next.held[region] = false
  } else if (!ids.length)
    // Filling the center takes all the space the snapped sides leave.
    next.held = { left: false, right: false, bottom: false }
  const at = beside ? ids.indexOf(beside.id) : -1
  if (at < 0) {
    // At the end of the region, with an equal share.
    const share = ids.length ? 1 / (ids.length + 1) : 1
    for (let i = 0; i < fractions.length; i++) fractions[i] *= 1 - share
    ids.push(id)
    fractions.push(share)
    return next
  }
  if (region === "center" && ids.length === 1)
    next.axis =
      beside!.side === "left" || beside!.side === "right" ? "row" : "column"
  const before = beside!.side === "left" || beside!.side === "top"
  const half = fractions[at] / 2
  fractions[at] = half
  ids.splice(before ? at : at + 1, 0, id)
  fractions.splice(before ? at : at + 1, 0, half)
  return next
}

/** Shows or hides a side's windows; the rest take up the space meanwhile. */
export function setHidden(snaps: Snaps, edge: Edge, hidden: boolean): Snaps {
  const next = copy(snaps)
  next.hidden[edge] = hidden
  return next
}

/** Whether a side takes room: it holds windows (or kept their space) and is not hidden. */
const shown = (snaps: Snaps, edge: Edge) =>
  (snaps.regions[edge].length > 0 || snaps.held[edge]) && !snaps.hidden[edge]

/** The side sizes that fit the workbench, the center keeping its minimum. */
function fitted(snaps: Snaps, size: Size): Record<Edge, number> {
  let left = shown(snaps, "left") ? snaps.sizes.left : 0
  let right = shown(snaps, "right") ? snaps.sizes.right : 0
  const room = Math.max(0, size.width - MIN_CENTER.width)
  if (left + right > room) {
    const scale = room / (left + right)
    left = Math.floor(left * scale)
    right = Math.floor(right * scale)
  }
  const bottom = shown(snaps, "bottom")
    ? Math.min(snaps.sizes.bottom, Math.max(0, size.height - MIN_CENTER.height))
    : 0
  return { left, right, bottom }
}

/** The box each region takes in a workbench of this size. */
export function regionBoxes(snaps: Snaps, size: Size): Record<Region, Box> {
  const { left, right, bottom } = fitted(snaps, size)
  const middle = size.width - left - right
  return {
    left: { left: 0, top: 0, width: left, height: size.height },
    right: {
      left: size.width - right,
      top: 0,
      width: right,
      height: size.height,
    },
    bottom: { left, top: size.height - bottom, width: middle, height: bottom },
    center: { left, top: 0, width: middle, height: size.height - bottom },
  }
}

/** Splits a box among windows by their shares, along an axis. */
function share(box: Box, fractions: number[], axis: "row" | "column") {
  const total = fractions.reduce((sum, f) => sum + f, 0) || 1
  const length = axis === "row" ? box.width : box.height
  let offset = 0
  return fractions.map((fraction, i) => {
    const start = Math.round(offset)
    offset += (length * fraction) / total
    const end = i === fractions.length - 1 ? length : Math.round(offset)
    return axis === "row"
      ? {
          left: box.left + start,
          top: box.top,
          width: end - start,
          height: box.height,
        }
      : {
          left: box.left,
          top: box.top + start,
          width: box.width,
          height: end - start,
        }
  })
}

/** Every shown snapped window's box, by id. Hidden sides give none. */
export function snapBoxes(snaps: Snaps, size: Size): Map<string, Box> {
  const boxes = regionBoxes(snaps, size)
  const result = new Map<string, Box>()
  for (const region of REGIONS) {
    if (region !== "center" && snaps.hidden[region]) continue
    const ids = snaps.regions[region]
    if (!ids.length) continue
    share(
      boxes[region],
      snaps.fractions[region],
      axisOf(snaps, region)
    ).forEach((box, i) => result.set(ids[i], box))
  }
  return result
}

/**
 * Takes a snapped window's box after the user resized it by an edge: its
 * side's size follows the edge facing the center, and its share follows
 * the edge facing its neighbor in the region.
 */
export function resized(snaps: Snaps, id: string, box: Box, size: Size): Snaps {
  const region = regionOf(snaps, id)
  if (!region) return snaps
  const next = copy(snaps)
  if (region === "left" || region === "right")
    next.sizes[region] = Math.max(MIN.width, Math.round(box.width))
  if (region === "bottom")
    next.sizes.bottom = Math.max(MIN.height, Math.round(box.height))
  const ids = next.regions[region]
  if (ids.length > 1) {
    const regionBox = regionBoxes(next, size)[region]
    const axis = axisOf(next, region)
    const length = axis === "row" ? regionBox.width : regionBox.height
    const own = axis === "row" ? box.width : box.height
    const index = ids.indexOf(id)
    const neighbor = index < ids.length - 1 ? index + 1 : index - 1
    const fractions = next.fractions[region]
    const total = fractions.reduce((sum, f) => sum + f, 0) || 1
    const pair = fractions[index] + fractions[neighbor]
    const wanted = (Math.max(MIN.height, own) / length) * total
    fractions[index] = Math.min(
      Math.max(wanted, 0.05 * total),
      pair - 0.05 * total
    )
    fractions[neighbor] = pair - fractions[index]
  }
  return next
}

/** A saved model, checked: anything malformed starts empty. */
export function readSnaps(value: unknown): Snaps {
  const base = emptySnaps()
  if (!value || typeof value !== "object") return base
  const saved = value as Partial<Snaps>
  for (const region of REGIONS) {
    const ids = saved.regions?.[region]
    const fractions = saved.fractions?.[region]
    if (
      Array.isArray(ids) &&
      Array.isArray(fractions) &&
      ids.length === fractions.length
    ) {
      base.regions[region] = ids.map(String)
      base.fractions[region] = fractions.map(Number)
    }
  }
  for (const edge of EDGES) {
    const size = saved.sizes?.[edge]
    if (typeof size === "number" && size > 0) base.sizes[edge] = size
    base.hidden[edge] = !!saved.hidden?.[edge]
    base.held[edge] = !!saved.held?.[edge] && !base.regions[edge].length
  }
  if (saved.axis === "column") base.axis = "column"
  return base
}
