import { describe, expect, test } from "bun:test"
import { rowTooltipParts } from "@/features/workflow/RowTooltip"

const row = { name: "combine", hasValue: true, valueClipped: false, nameClipped: false }

describe("rowTooltipParts", () => {
  test("a description shows under the name", () => {
    expect(rowTooltipParts({ ...row, about: "Type of combine operation" })).toEqual({
      description: "Type of combine operation",
      value: false,
    })
  })

  test("a value shows only when the row cuts it off", () => {
    expect(rowTooltipParts({ ...row, about: "Input images", valueClipped: true })?.value).toBe(true)
    expect(rowTooltipParts({ ...row, about: "Input images", hasValue: false, valueClipped: true })?.value).toBe(false)
  })

  test("a description that repeats the name is left out", () => {
    expect(rowTooltipParts({ ...row, about: "combine", valueClipped: true })).toEqual({
      description: undefined,
      value: true,
    })
  })

  test("nothing to add opens no tooltip", () => {
    expect(rowTooltipParts({ ...row, about: "combine" })).toBeNull()
    expect(rowTooltipParts({ ...row, about: "  " })).toBeNull()
    expect(rowTooltipParts(row)).toBeNull()
  })

  test("a cut-off name still opens the tooltip with the name alone", () => {
    expect(rowTooltipParts({ ...row, nameClipped: true })).toEqual({ description: undefined, value: false })
  })
})
