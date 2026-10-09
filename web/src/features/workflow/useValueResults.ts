import { useMemo } from "react"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { api, type Catalog } from "@/lib/workbench"
import type { TaskMap } from "@/lib/task-map"
import { formatScalar, formatValue, isValueSource, valueRefs, valueRequest, VALUE_HANDLE, type ValueResponse } from "@/lib/values"

/**
 * Current values of every value output on the canvas and of each value
 * connection, evaluated by the server (giraf/values.py). Moving nodes keeps
 * the request unchanged, so only value edits and new runs refetch.
 */
export function useValueResults(map: TaskMap, catalog: Catalog) {
  const request = useMemo(() => ({ ...valueRequest(map, catalog), refs: valueRefs(map, catalog) }), [map, catalog])
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
