import type { TaskMap } from "@/lib/task-map"
import type { Catalog, Frame } from "@/lib/workbench"
import { type DropChoice } from "./context"
import { useCallback, useRef, useState, type DragEvent } from "react"
import { type Connection as FlowConnection, type Edge } from "@xyflow/react"
import { toast } from "@/components/ui/toast"
import { type Source } from "@/lib/task-map"
import { connectionChoices } from "@/lib/node-interaction"
import {
  connectFlow,
  connectionFeedback,
  connectInputPort,
} from "@/lib/workflow-flow"

export function useMapConnections({
  map,
  catalog,
  rows,
  update,
  choose,
}: {
  map: TaskMap
  catalog: Catalog
  rows: Frame[]
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
  choose: (id: string) => void
}) {
  const [dropChoice, setDropChoice] = useState<DropChoice | null>(null)

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
  function finishDrop(target: string, source: Source, role: string) {
    try {
      const next = connectInputPort(
        map,
        catalog,
        rows,
        target,
        role,
        source,
        true
      )
      update(() => next, "입력 연결")
      setDropChoice(null)
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }
  function drop(event: DragEvent, target: string) {
    event.preventDefault()
    event.stopPropagation()
    const raw = event.dataTransfer.getData("application/giraf-source")
    if (!raw) return
    try {
      const source: Source = JSON.parse(raw)
      const roles = connectionChoices(map, catalog, source, target, rows)
      const role = (event.target as HTMLElement).closest<HTMLElement>(
        "[data-input-role]"
      )?.dataset.inputRole
      if (role || roles.length === 1)
        finishDrop(target, source, role ?? roles[0].name)
      else {
        setDropChoice({ source, target, roles: roles.map((s) => s.name) })
        choose(target)
      }
    } catch (error) {
      toast.add({ title: (error as Error).message, type: "error" })
    }
  }

  return {
    validateConnection,
    drop,
    finishDrop,
    setDropChoice,
    finishConnection,
    isValidConnection,
    reconnectingRef,
    dropChoice,
  }
}
