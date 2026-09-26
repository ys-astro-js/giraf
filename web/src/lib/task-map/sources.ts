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
  selectedFiles: string[],
  map: TaskMap,
  jobs: Job[]
): ConnectionSourceOption[] {
  return [
    ...(selectedFiles.length
      ? [
          {
            key: "selection",
            label: "자료 목록 선택",
            count: selectedFiles.length,
            source: {
              kind: "files",
              ids: selectedFiles,
              label: "선택한 자료",
            } as Source,
          },
        ]
      : []),
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
