import { useEffect, useRef } from "react"
import { useReactFlow, useStoreApi } from "@xyflow/react"
import { panTarget } from "@/lib/workflow-flow"

/** Pans a node into view once it is measured, keeping the zoom. */
export function PanToNode({
  request,
}: {
  request: { id: string; revision: number } | undefined
}) {
  const flow = useReactFlow()
  const store = useStoreApi()
  const handled = useRef(request?.revision)
  useEffect(() => {
    if (!request || handled.current === request.revision) return
    const revision = request.revision
    // A new node is measured after it renders; pan once its size is known.
    const pan = () => {
      const { nodeLookup, transform, width, height } = store.getState()
      const node = nodeLookup.get(request.id)
      if (!node?.measured.width || !node.measured.height) return false
      handled.current = revision
      const [x, y, zoom] = transform
      const target = panTarget(
        {
          ...node.internals.positionAbsolute,
          width: node.measured.width,
          height: node.measured.height,
        },
        { x, y, zoom },
        { width, height }
      )
      if (target) void flow.setCenter(target.x, target.y, { zoom })
      return true
    }
    if (pan()) return
    return store.subscribe(() => {
      if (handled.current !== revision) pan()
    })
  }, [flow, store, request])
  return null
}
