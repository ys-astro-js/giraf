export type Pair = [number, number]
export function parsePairs(value: string): Pair[] | null {
  const lines = value.trim()
    ? value
        .trim()
        .split(/\n/)
        .filter((v) => v.trim())
    : []
  const pairs = lines.map((line) => line.trim().split(/\s+/).map(Number))
  return pairs.every((p) => p.length === 2 && p.every(Number.isFinite))
    ? (pairs as Pair[])
    : null
}
export function alignmentShift(reference: Pair, input: Pair): Pair {
  return [reference[0] - input[0], reference[1] - input[1]]
}
export function replaceShift(
  value: string,
  index: number,
  shift: Pair,
  count: number
) {
  const lines = value.trim() ? value.trim().split("\n") : []
  const result = Array.from({ length: count }, (_, i) => lines[i] || "? ?")
  result[index] = shift.map((n) => Number(n.toFixed(3))).join(" ")
  return result.join("\n") + "\n"
}

export type ShiftSelection = { anchor?: Pair; index: number; value: string }

// The matching star is picked independently of the registration objects in coords.
export function pickAlignmentStar(
  selection: ShiftSelection,
  point: Pair,
  referenceId: string,
  frameIds: string[]
): ShiftSelection {
  if (selection.index === -1 || !selection.anchor) {
    const first = frameIds.findIndex((id) => id !== referenceId)
    return {
      anchor: point,
      index: first < 0 ? 0 : first,
      value:
        frameIds
          .map((id) =>
            id === referenceId ? alignmentShift(point, point).join(" ") : "? ?"
          )
          .join("\n") + "\n",
    }
  }
  const { anchor, index } = selection
  const value = replaceShift(
    selection.value,
    index,
    alignmentShift(anchor, frameIds[index] === referenceId ? anchor : point),
    frameIds.length
  )
  const next = frameIds.findIndex((id, i) => i > index && id !== referenceId)
  return { anchor, value, index: next < 0 ? index : next }
}

export function alignmentRows(value: string) {
  return value
    .split("\n")
    .map((text) => text.trim())
    .filter(Boolean)
    .map((text) => {
      const pair = parsePairs(text)?.[0]
      return { text, point: pair && pair.every((n) => n >= 1) ? pair : null }
    })
}

export function shiftsFromStars(
  anchor: Pair,
  points: Record<number, Pair>,
  referenceId: string,
  frameIds: string[]
) {
  return (
    frameIds
      .map((id, index) => {
        const point = id === referenceId ? anchor : points[index]
        return point
          ? alignmentShift(anchor, point)
              .map((n) => Number(n.toFixed(3)))
              .join(" ")
          : "? ?"
      })
      .join("\n") + "\n"
  )
}
