import { expect, test } from "bun:test"
import { panTarget } from "../src/lib/workflow-flow"

const size = { width: 800, height: 600 }

test("a node already in view needs no pan", () => {
  expect(
    panTarget({ x: 100, y: 100, width: 200, height: 80 }, { x: 0, y: 0, zoom: 1 }, size)
  ).toBeNull()
})

test("a node outside the view is centered without changing zoom", () => {
  expect(
    panTarget({ x: 900, y: 100, width: 200, height: 80 }, { x: 0, y: 0, zoom: 1 }, size)
  ).toEqual({ x: 1000, y: 140 })
})

test("the visible area follows pan and zoom", () => {
  // At zoom 0.5 panned by (-400, -300), the view covers flow (800, 600) to (2400, 1800).
  const viewport = { x: -400, y: -300, zoom: 0.5 }
  expect(
    panTarget({ x: 1000, y: 700, width: 200, height: 80 }, viewport, size)
  ).toBeNull()
  expect(
    panTarget({ x: 700, y: 700, width: 200, height: 80 }, viewport, size)
  ).toEqual({ x: 800, y: 740 })
})
