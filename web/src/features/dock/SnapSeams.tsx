import { useRef } from "react"
import { createPortal } from "react-dom"
import { currentSeams, dockRoot, moveSeam, settleSeam, useDock } from "./store"

/** How wide a seam takes the pointer, centered on the line between windows. */
const GRAB = 8

/**
 * The boundaries between snapped windows, as handles of their own: each
 * lies over the line two windows share, so it is always within reach, and
 * dragging it moves both windows together (see dragSeam in layout.ts).
 * Free windows float above them.
 */
export function SnapSeams() {
  useDock((state) => state.revision)
  useDock((state) => state.snaps)
  const dragging = useRef(false)
  const root = dockRoot()
  if (!root) return null
  return createPortal(
    <div className="snap-seams" aria-hidden="true">
      {currentSeams().map(({ seam, axis, at, from, to }) => (
        <div
          key={
            seam.kind === "side"
              ? `side:${seam.edge}`
              : `split:${seam.region}:${seam.index}`
          }
          className="snap-seam"
          data-axis={axis}
          style={
            axis === "x"
              ? {
                  left: at - GRAB / 2,
                  top: from,
                  width: GRAB,
                  height: to - from,
                }
              : {
                  left: from,
                  top: at - GRAB / 2,
                  width: to - from,
                  height: GRAB,
                }
          }
          onPointerDown={(event) => {
            if (event.button !== 0) return
            event.preventDefault()
            dragging.current = true
            try {
              event.currentTarget.setPointerCapture(event.pointerId)
            } catch {
              // An ended pointer cannot be captured; the drag goes on.
            }
            document.body.dataset.windowDragging = "true"
            window.getSelection()?.removeAllRanges()
          }}
          onPointerMove={(event) => {
            if (dragging.current)
              moveSeam(seam, event.clientX, event.clientY, axis)
          }}
          onPointerUp={() => {
            if (!dragging.current) return
            dragging.current = false
            delete document.body.dataset.windowDragging
            settleSeam()
          }}
          onPointerCancel={() => {
            dragging.current = false
            delete document.body.dataset.windowDragging
            settleSeam()
          }}
        />
      ))}
    </div>,
    root
  )
}
