import { describe, expect, test } from "bun:test"
import { clippedTitle } from "@/lib/clipped-title"

describe("clippedTitle", () => {
  test("a cut-off label shows its full text", () => {
    expect(clippedTitle({ scrollWidth: 120, clientWidth: 80 }, "ccd_object_0012.fits")).toBe(
      "ccd_object_0012.fits"
    )
  })

  test("a label that fits shows no tooltip", () => {
    expect(clippedTitle({ scrollWidth: 80, clientWidth: 80 }, "input")).toBe("")
  })
})
