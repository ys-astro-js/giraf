import {
  Position,
  type ConnectionState,
  type Handle,
  type InternalNode,
  type XYPosition,
} from "@xyflow/react"

type PreviewInput = {
  fromNode: InternalNode
  fromHandle: Handle
  toNode?: InternalNode
  toHandle?: Handle
  pointer: XYPosition
  transform: [number, number, number]
  isValid?: boolean
}
const opposite = {
  [Position.Left]: Position.Right,
  [Position.Right]: Position.Left,
  [Position.Top]: Position.Bottom,
  [Position.Bottom]: Position.Top,
}
function center(node: InternalNode, handle: Handle) {
  return {
    x: node.internals.positionAbsolute.x + handle.x + handle.width / 2,
    y: node.internals.positionAbsolute.y + handle.y + handle.height / 2,
  }
}
/** React Flow stores the source in flow coordinates and the endpoint in pane pixels. */
export function clickConnectionPreview({
  fromNode,
  fromHandle,
  toNode,
  toHandle,
  pointer,
  transform,
  isValid,
}: PreviewInput): ConnectionState {
  const target = toNode && toHandle ? center(toNode, toHandle) : null
  return {
    inProgress: true,
    fromNode,
    fromHandle,
    from: center(fromNode, fromHandle),
    fromPosition: fromHandle.position,
    toNode: toNode ?? null,
    toHandle: toHandle ?? null,
    to:
      target && isValid
        ? {
            x: target.x * transform[2] + transform[0],
            y: target.y * transform[2] + transform[1],
          }
        : pointer,
    toPosition:
      isValid && toHandle ? toHandle.position : opposite[fromHandle.position],
    isValid: toHandle ? (isValid ?? false) : null,
    pointer,
  }
}
