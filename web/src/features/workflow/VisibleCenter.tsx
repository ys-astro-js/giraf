import { useEffect } from "react"
import { useStoreApi } from "@xyflow/react"
import { useLayout } from "@/features/workbench/layout-store"

/** Tells the workbench where the middle of the visible canvas is, so new nodes land in view. */
export function VisibleCenter() {
  const store = useStoreApi()
  useEffect(() => {
    useLayout.setState({
      visibleCenter: () => {
        const { transform, width, height } = store.getState()
        const [x, y, zoom] = transform
        if (!width || !height) return undefined
        return { x: (width / 2 - x) / zoom, y: (height / 2 - y) / zoom }
      },
    })
    return () => useLayout.setState({ visibleCenter: undefined })
  }, [store])
  return null
}
