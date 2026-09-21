import { expect, test } from "bun:test"
import { imagePosition, pixelPosition } from "../src/lib/viewer-navigation"
import { shiftsFromStars } from "../src/lib/alignment"

const image = { width: 100, height: 100 }
const placement = { x: 20, y: 30, width: 200, height: 200 }
test("star clicks preserve subpixel FITS coordinates through zoom and pan", () => {
  expect(imagePosition({ x: 85.5, y: 122.5 }, placement, image, true)).toEqual({
    x: 33.25,
    y: 54.25,
  })
  expect(
    imagePosition(
      { x: 141, y: 229 },
      { x: 10, y: 44, width: 400, height: 400 },
      image,
      true
    )
  ).toEqual({ x: 33.25, y: 54.25 })
  expect(imagePosition({ x: 85.5, y: 122.5 }, placement, image)).toEqual({
    x: 33,
    y: 54,
  })
  expect(imagePosition({ x: 19, y: 122.5 }, placement, image, true)).toBeNull()
  expect(imagePosition({ x: 220, y: 122.5 }, placement, image, true)).toBeNull()
  expect(imagePosition({ x: 21, y: 229 }, placement, image, true)).toEqual({
    x: 1,
    y: 1,
  })
})
test("manual star coordinates accept decimals without weakening pixel inspection validation", () => {
  expect(pixelPosition("33.25", "54.125", image, true)).toEqual({
    x: 33.25,
    y: 54.125,
  })
  expect(pixelPosition("33.25", "54.125", image)).toBeNull()
  for (const x of ["NaN", "Infinity", "", "0.9", "100.1"])
    expect(pixelPosition(x, "4", image, true)).toBeNull()
})
test("reference rows subtract the shared subpixel point, wherever they occur", () => {
  const anchor: [number, number] = [33.25, 54.125]
  expect(
    shiftsFromStars(anchor, { 1: [34.95, 52.225] }, "ref", ["ref", "b"])
  ).toBe("0 0\n-1.7 1.9\n")
  expect(
    shiftsFromStars(anchor, { 0: [34.95, 52.225] }, "ref", ["b", "ref"])
  ).toBe("-1.7 1.9\n0 0\n")
  expect(shiftsFromStars(anchor, { 0: [34.95, 52.225] }, "ref", ["b"])).toBe(
    "-1.7 1.9\n"
  )
})
