import { useMemo } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { api, type Catalog, type Frame } from "@/lib/workbench"
import type { TaskMap } from "@/lib/task-map"
import { taskGroups } from "@/lib/splits"
import { formatScalar, formatValue, isValueSource, valueRefs, valueRequest, VALUE_HANDLE, type ValueResponse } from "@/lib/values"

/**
 * Current values of every value output on the canvas and of each value
 * connection, evaluated by the server (giraf/values.py). Moving nodes keeps
 * the request unchanged, so only value edits and new runs refetch.
 */
export function useValueResults(map: TaskMap, catalog: Catalog, rows: Frame[] = []) {
  const request = useMemo(() => {
    // A split task's links get one value per group (lib/group-values).
    const groupsOf = (id: string) => {
      const task = map.tasks.find((t) => t.id === id)
      return task ? taskGroups(map, task, rows).groups?.map((g) => g.id) : undefined
    }
    return { ...valueRequest(map, catalog, new Set(), groupsOf), refs: valueRefs(map, catalog) }
  }, [map, catalog, rows])
  const key = JSON.stringify(request)
  const { data } = useQuery({
    queryKey: ["api", "values", key],
    queryFn: ({ signal }) => api<ValueResponse>("values", JSON.parse(key), signal),
    enabled: request.refs.length > 0,
    placeholderData: keepPreviousData,
  })
  // The label of a value connection: the value its target takes, else the output's values.
  const label = (connectionId: string) => {
    const connection = map.connections.find((c) => c.id === connectionId)
    if (!connection || !isValueSource(connection.source) || connection.source.kind === "files") return ""
    const taken = data?.parameters[connectionId]
    if (taken && taken.error === undefined) return formatScalar(taken.value)
    const output = connection.source.outputRole?.slice(VALUE_HANDLE.length)
    return formatValue(data?.outputs[`${connection.source.taskId}:${output}`])
  }
  return { results: data, label }
}
