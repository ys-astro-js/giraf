import { expect, test } from "bun:test"
import { middleEllipsis } from "../src/lib/middle-ellipsis"
const measure = (text: string) => Array.from(text).length

test("keeps both ends including the extension while fitting the available width", () => {
  const name = "AutosaveImage-0001bias.fits"
  expect(middleEllipsis(name, 40, measure)).toBe(name)
  const shortened = middleEllipsis(name, 18, measure)
  expect(shortened.startsWith("Autosave")).toBe(true)
  expect(shortened.endsWith("bias.fits")).toBe(true)
  expect(shortened).toContain("…")
  expect(measure(shortened)).toBeLessThanOrEqual(18)
  for (const width of [0, 1, 2, 3, 5, 10])
    expect(measure(middleEllipsis(name, width, measure))).toBeLessThanOrEqual(
      width
    )
})
test("does not split unicode code points and handles unequal glyph widths", () => {
  const text = "관측🌙파일000001.fits"
  const proportional = (value: string) =>
    Array.from(value).reduce(
      (sum, c) => sum + (/[^\x00-\x7F]/.test(c) ? 2 : 1),
      0
    )
  const result = middleEllipsis(text, 15, proportional)
  expect(result).toContain("…")
  expect(result.endsWith(".fits")).toBe(true)
  expect(result).not.toMatch(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
  )
  expect(proportional(result)).toBeLessThanOrEqual(15)
})
