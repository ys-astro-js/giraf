import { useEffect, useEffectEvent, type ReactNode } from "react"
import { Panel, useStore, type ReactFlowState } from "@xyflow/react"
import type { SelectionArea as Area } from "./useSubflows"

/** The area being dragged, in flow coordinates. */
function dragged(state: ReactFlowState): Area | null {
  const rect = state.userSelectionActive ? state.userSelectionRect : null
  if (!rect) return null
  const [x, y, zoom] = state.transform
  return {
    x: (rect.x - x) / zoom,
    y: (rect.y - y) / zoom,
    width: rect.width / zoom,
    height: rect.height / zoom,
  }
}
const sameArea = (a: Area | null, b: Area | null) =>
  a === b ||
  (!!a &&
    !!b &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height)

/**
 * The selecting mode's dragged area: it selects while dragged, then stays
 * drawn like React Flow's own selection rectangle, following pan and zoom at
 * screen scale, with the selection's actions just above its top-right corner.
 */
export function SelectionArea({
  area,
  onDrag,
  children,
}: {
  area: Area | null
  onDrag: (area: Area) => void
  children?: ReactNode
}) {
  const live = useStore(dragged, sameArea)
  const [x, y, zoom] = useStore((state) => state.transform)
  const report = useEffectEvent((next: Area) => onDrag(next))
  useEffect(() => {
    if (live) report(live)
  }, [live])
  // React Flow draws the area while it is dragged.
  if (live || !area) return null
  const left = area.x * zoom + x
  const top = area.y * zoom + y
  const width = area.width * zoom
  return (
    <>
      <div
        className="react-flow__selection"
        aria-hidden="true"
        style={{
          position: "absolute",
          left,
          top,
          width,
          height: area.height * zoom,
          // Under the toolbars, like the dragged one.
          zIndex: 4,
          pointerEvents: "none",
        }}
      />
      {children && (
        <Panel
          position="top-left"
          style={{
            left: left + width,
            top: top - 8,
            transform: "translate(-100%, -100%)",
            margin: 0,
          }}
        >
          {children}
        </Panel>
      )}
    </>
  )
}
