// Specified before implementing the click-preview bridge.
import { expect, test } from "bun:test"
import { Position, type InternalNode, type Handle } from "@xyflow/react"
import { clickConnectionPreview } from "../src/lib/click-connection"
const node = (id: string, x: number, y: number): InternalNode => ({
  id,
  position: { x, y },
  data: {},
  measured: { width: 280, height: 176 },
  internals: {
    positionAbsolute: { x, y },
    z: 0,
    userNode: { id, position: { x, y }, data: {} },
  },
})
const fromNode = node("a", 100, 50),
  toNode = node("b", 600, 100)
const fromHandle: Handle = {
  id: "output",
  nodeId: "a",
  type: "source",
  position: Position.Right,
  x: 266,
  y: 138,
  width: 28,
  height: 28,
}
const toHandle: Handle = {
  id: "images",
  nodeId: "b",
  type: "target",
  position: Position.Left,
  x: -6,
  y: 90,
  width: 12,
  height: 12,
}
const base = {
  fromNode,
  fromHandle,
  pointer: { x: 430, y: 250 },
  transform: [20, 30, 0.5] as [number, number, number],
}
test("click preview follows the pointer and anchors the source in flow coordinates", () => {
  const result = clickConnectionPreview(base)
  expect(result.from).toEqual({ x: 380, y: 202 })
  expect(result.to).toEqual(base.pointer)
  expect(result.isValid).toBeNull()
  expect(result.toPosition).toBe(Position.Left)
})
test("valid hovered input snaps to its center under pan and zoom", () => {
  const result = clickConnectionPreview({
    ...base,
    toNode,
    toHandle,
    isValid: true,
  })
  expect(result.to).toEqual({ x: 320, y: 128 })
  expect(result.toNode?.id).toBe("b")
  expect(result.toHandle?.id).toBe("images")
  expect(result.isValid).toBe(true)
})
test("invalid input stays at the pointer, exposes invalid status, and does not snap", () => {
  const result = clickConnectionPreview({
    ...base,
    toNode,
    toHandle,
    isValid: false,
  })
  expect(result.to).toEqual(base.pointer)
  expect(result.isValid).toBe(false)
})
test("reverse click connections use the opposite side of the starting handle", () => {
  const result = clickConnectionPreview({
    ...base,
    fromNode: toNode,
    fromHandle: toHandle,
  })
  expect(result.from).toEqual({ x: 600, y: 196 })
  expect(result.toPosition).toBe(Position.Right)
})
