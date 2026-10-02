import type { TaskMap } from "@/lib/task-map"
import type { Catalog, Frame } from "@/lib/workbench"
import { useCallback, useRef } from "react"
import { type Connection as FlowConnection, type Edge } from "@xyflow/react"
import { toast } from "@/components/ui/toast"
import { connectFlow, connectionFeedback } from "@/lib/workflow-flow"

export function useMapConnections({
  map,
  catalog,
  rows,
  update,
}: {
  map: TaskMap
  catalog: Catalog
  rows: Frame[]
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
}) {
  const reconnectingRef = useRef<string | undefined>(undefined)

  const validateConnection = useCallback(
    (connection: FlowConnection) =>
      connectionFeedback(
        map,
        catalog,
        rows,
        connection,
        reconnectingRef.current
      ),
    [map, catalog, rows]
  )
  const isValidConnection = useCallback(
    (connection: FlowConnection | Edge) =>
      validateConnection({
        ...connection,
        sourceHandle: connection.sourceHandle ?? null,
        targetHandle: connection.targetHandle ?? null,
      }).valid,
    [validateConnection]
  )
  function finishConnection(connection: FlowConnection, replacingId?: string) {
    try {
      const next = connectFlow(map, catalog, rows, connection, replacingId)
      update(() => next, replacingId ? "연결 변경" : "연결 추가")
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  return {
    validateConnection,
    finishConnection,
    isValidConnection,
    reconnectingRef,
  }
}
