import { useState } from "react"
import type { Draft } from "@/lib/workbench"
import { FolderOpen, RotateCcw } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { TabsContent } from "@/components/ui/tabs"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import { Choice } from "@/components/workbench-controls"
import { type Spec, type Slot, type Values } from "@/lib/workbench"
import { type Instance, resetInstanceParameters } from "@/lib/task-map"
import { ParameterEditorFields } from "@/components/parameter-editor"
import { type ParameterGroup } from "@/lib/parameter-presentation"

export function InspectorSettings({
  groups,
  query,
  spec,
  d,
  pick,
  task,
  edit,
  saveDefaults,
}: {
  groups: ParameterGroup[]
  query: string
  spec: Spec
  d: Draft
  pick: (slot: Slot, ids: string[], apply: (ids: string[]) => void) => void
  task: Instance
  edit: (fn: (t: Instance) => Instance) => void
  saveDefaults: () => void
}) {
  const [resetValues, setResetValues] = useState<{
    parameters: Values
    parameterSets?: Record<string, Values>
  } | null>(null)
  return (
    <TabsContent value="settings" className="inspector-settings">
      <div className="parameter-editor-body">
        <ParameterEditorFields
          groups={groups}
          query={query}
          changedOnly={false}
        />

        {spec.name === "ccdhedit" && String(d.parameters.value) === "" && (
          <Alert>
            <AlertDescription>
              value를 비워 두면 해당 헤더 항목을 삭제합니다.
            </AlertDescription>
          </Alert>
        )}
        {!query.trim() && (
          <Accordion multiple>
            {spec.adapter !== "generic" && (
              <AccordionItem value="package">
                <AccordionTrigger>instrument</AccordionTrigger>
                <AccordionContent>
                  <div className="flex items-center gap-2 py-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        pick(
                          {
                            name: "instrument",
                            label: "instrument",
                            multiple: false,
                            kind: "text",
                          },
                          task.instrument,
                          (ids) => edit((t) => ({ ...t, instrument: ids }))
                        )
                      }
                    >
                      <FolderOpen data-icon="inline-start" />
                      instrument
                    </Button>
                    {task.instrument.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => edit((t) => ({ ...t, instrument: [] }))}
                      >
                        해제
                      </Button>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}
            {spec.adapter !== "generic" && (
              <AccordionItem value="files">
                <AccordionTrigger>파일 처리</AccordionTrigger>
                <AccordionContent>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="file-policy">실행 대상</FieldLabel>
                      <Choice
                        id="file-policy"
                        label="실행 대상"
                        value={task.filePolicy.mode}
                        options={[
                          { value: "copy", label: "사본" },
                          { value: "direct", label: "원본 파일" },
                        ]}
                        onChange={(v) =>
                          edit((t) => ({
                            ...t,
                            filePolicy: {
                              ...t.filePolicy,
                              mode: v as "copy" | "direct",
                            },
                          }))
                        }
                      />
                    </Field>
                    {task.filePolicy.mode === "direct" && (
                      <Field className="parameter-field">
                        <FieldLabel htmlFor="backup-policy">
                          원본 백업
                        </FieldLabel>
                        <Switch
                          id="backup-policy"
                          checked={task.filePolicy.backup}
                          onCheckedChange={(v) =>
                            edit((t) => ({
                              ...t,
                              filePolicy: {
                                ...t.filePolicy,
                                backup: v,
                              },
                            }))
                          }
                        />
                      </Field>
                    )}
                  </FieldGroup>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
        )}
        <div className="inspector-secondary">
          <Button variant="outline" size="sm" onClick={saveDefaults}>
            기본 설정으로 저장
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setResetValues(
                structuredClone({
                  parameters: d.parameters,
                  parameterSets: task.parameterSets,
                })
              )
              edit((t) => resetInstanceParameters(t, spec))
            }}
          >
            <RotateCcw data-icon="inline-start" />
            설정 초기화
          </Button>
          {resetValues && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                edit((t) => ({
                  ...t,
                  draft: {
                    ...t.draft,
                    parameters: resetValues.parameters,
                  },
                  parameterSets: resetValues.parameterSets,
                }))
                setResetValues(null)
              }}
            >
              초기화 취소
            </Button>
          )}
        </div>
      </div>
    </TabsContent>
  )
}
