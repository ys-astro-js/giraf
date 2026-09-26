import { connectionSourceOptions } from "@/lib/task-map/sources"
import type { Job } from "@/lib/workbench"
import type { LinkDialog } from "@/features/workbench/types"
import { FolderOpen, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Choice, Failure } from "@/components/workbench-controls"
import { type Catalog, type Slot } from "@/lib/workbench"
import { connect, connectionRoles, type TaskMap } from "@/lib/task-map"
import type * as React from "react"

export function ConnectInputDialog({
  linking,
  setLinking,
  error,
  catalog,
  map,
  selectedFiles,
  jobs,
  pick,
  update,
  setError,
}: {
  linking: LinkDialog | null
  setLinking: React.Dispatch<React.SetStateAction<LinkDialog | null>>
  error: string
  catalog: Catalog | null
  map: TaskMap
  selectedFiles: string[]
  jobs: Job[]
  pick: (slot: Slot, ids: string[], apply: (ids: string[]) => void) => void
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
  setError: React.Dispatch<React.SetStateAction<string>>
}) {
  const sourceOptions = connectionSourceOptions(selectedFiles, map, jobs)
  return (
    <Dialog
      open={!!linking}
      onOpenChange={(v) => {
        if (!v) setLinking(null)
      }}
    >
      <DialogContent
        className="max-h-[85dvh] overflow-auto"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>입력 연결</DialogTitle>
        </DialogHeader>
        <Failure message={error} />
        {linking && catalog && (
          <>
            <FieldGroup>
              <Field>
                <FieldLabel>대상 작업</FieldLabel>
                <Choice
                  label="대상 작업"
                  value={linking.target}
                  options={map.tasks.map((t) => ({
                    value: t.id,
                    label: t.label,
                  }))}
                  onChange={(v) => {
                    const t = map.tasks.find((t) => t.id === v)!
                    setLinking({
                      ...linking,
                      target: v,
                      role: catalog.tasks.find((s) => s.name === t.task)!
                        .inputs[0].name,
                    })
                  }}
                />
              </Field>
              <Field>
                <FieldLabel>입력 항목</FieldLabel>
                <Choice
                  label="입력 항목"
                  value={linking.role}
                  options={connectionRoles(
                    catalog.tasks.find(
                      (s) =>
                        s.name ===
                        map.tasks.find((t) => t.id === linking.target)?.task
                    ) || catalog.tasks[0],
                    catalog
                  ).map((s) => ({
                    value: s.name,
                    label: s.label,
                    description: s.name,
                  }))}
                  onChange={(v) => setLinking({ ...linking, role: v })}
                />
              </Field>
              <Field>
                <FieldLabel>가져올 파일 또는 결과</FieldLabel>
                <Choice
                  label="가져올 파일 또는 결과"
                  value={linking.sourceKey}
                  options={[
                    ...(linking.source
                      ? [
                          {
                            value: "provided",
                            label:
                              linking.source.kind === "pending"
                                ? "이 작업의 출력"
                                : "선택한 결과",
                          },
                        ]
                      : []),
                    ...sourceOptions.map((o) => ({
                      value: o.key,
                      label: o.label,
                      description: o.description,
                      count: o.count,
                    })),
                  ]}
                  onChange={(v) => setLinking({ ...linking, sourceKey: v })}
                />
              </Field>
            </FieldGroup>
            <Button
              variant="outline"
              onClick={() => {
                const slot = connectionRoles(
                  catalog.tasks.find(
                    (s) =>
                      s.name ===
                      map.tasks.find((t) => t.id === linking.target)?.task
                  ) || catalog.tasks[0],
                  catalog
                ).find((s) => s.name === linking.role)!
                const target = linking.target,
                  role = linking.role
                pick(slot, [], (ids) => {
                  update(
                    (m) =>
                      connect(
                        m,
                        target,
                        role,
                        { kind: "files", ids, label: slot.label },
                        false
                      ),
                    "입력 파일 연결"
                  )
                  setLinking(null)
                })
              }}
            >
              <FolderOpen data-icon="inline-start" />
              외부 파일에서 선택
            </Button>
            <DialogFooter>
              <Button
                disabled={
                  !linking.target || !linking.role || !linking.sourceKey
                }
                onClick={() => {
                  const source =
                    linking.sourceKey === "provided"
                      ? linking.source
                      : sourceOptions.find((s) => s.key === linking.sourceKey)
                          ?.source
                  if (!source) return
                  try {
                    const next = connect(
                      map,
                      linking.target,
                      linking.role,
                      source,
                      connectionRoles(
                        catalog!.tasks.find(
                          (s) =>
                            s.name ===
                            map.tasks.find((t) => t.id === linking.target)?.task
                        )!,
                        catalog!
                      ).find((s) => s.name === linking.role)?.multiple ?? false
                    )
                    update(() => next, "연결 추가")
                    setLinking(null)
                  } catch (e) {
                    setError((e as Error).message)
                  }
                }}
              >
                <Link2 data-icon="inline-start" />
                연결
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
