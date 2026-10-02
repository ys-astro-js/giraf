import type { Job } from "@/lib/workbench"
import type { TaskMap, Source } from "./model"
export type ConnectionSourceOption = {
  key: string
  label: string
  description?: string
  count?: number
  source: Source
}
export function connectionSourceOptions(
  map: TaskMap,
  jobs: Job[]
): ConnectionSourceOption[] {
  return [
    ...map.tasks.map((t) => ({
      key: "pending:" + t.id,
      label: t.label + " 출력",
      source: { kind: "pending", taskId: t.id } as Source,
    })),
    ...jobs.flatMap((j) =>
      (j.products || [])
        .filter(
          (p) =>
            p.asset === "image" ||
            p.asset === "text" ||
            p.asset === "image-list"
        )
        .map((p) => ({
          key: "product:" + p.id,
          label: p.label,
          description: j.id,
          source: {
            kind: "result",
            taskId: j.manifest?.instanceId,
            runId: j.id,
            ids: [p.id],
          } as Source,
        }))
    ),
  ]
}
