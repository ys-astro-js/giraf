import { ccdTasks } from "@/lib/calibration"
import { inputPorts, portFrames } from "@/lib/calibration-ports"
import { assigned } from "@/lib/task-map/inputs"
import { outputPorts, groupEqual } from "@/lib/calibration-ports"
import { CalibrationControls } from "@/components/calibration-controls"
import { correctionFlags } from "@/lib/calibration"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { TabsContent } from "@/components/ui/tabs"
import { type Catalog, type Spec, type Frame, type Slot } from "@/lib/workbench"
import { type Instance, type TaskMap } from "@/lib/task-map"
import type * as React from "react"

export function InspectorInputs({
  slot,
  spec,
  map,
  task,
  edit,
  change,
  changePrep,
  setExpanded,
  catalog,
  rows,
  onInputSource,
}: {
  slot: (s: Slot, compact?: boolean, prefix?: string) => React.JSX.Element
  spec: Spec
  map: TaskMap
  task: Instance
  catalog: Catalog
  rows: Frame[]
  edit: (fn: (task: Instance) => Instance) => void
  change: (key: string, value: string) => void
  changePrep: (key: string, value: string) => void
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, number>>>
  onInputSource?: (
    role: string,
    source:
      import("@/lib/task-map").Source | { kind: "expression"; value: string }
  ) => void
}) {
  const d = task.draft
  const specialized = ccdTasks.has(spec.name)
  const allRows = [...rows, ...map.runs.flatMap((r) => r.products)]
  const selectedFrames = (role: string) =>
    assigned(map, task, role)
      .ids.map((id) => allRows.find((r) => r.id === id))
      .filter((r): r is Frame => !!r && r.asset !== "image-list")
  const displayPorts = inputPorts(map, task, catalog, allRows)
  const mainFrames = portFrames(
    map,
    task,
    spec.inputs[0]?.name || "input",
    catalog,
    allRows
  )
  const corrections =
    spec.name === "ccdproc" ? d.parameters : task.preprocess.parameters
  const changeCorrection = spec.name === "ccdproc" ? change : changePrep
  const showCalibration =
    specialized &&
    spec.name !== "zerocombine" &&
    (spec.name === "ccdproc" || d.parameters.process === "yes")
  const mainInputs =
    specialized && spec.adapter !== "generic"
      ? displayPorts.filter(
          (s) =>
            !s.group &&
            spec.inputs.some((input) => input.name === s.role) &&
            !correctionFlags[s.role] &&
            (!(s.role in { fixfile: 1, illum: 1, fringe: 1 }) ||
              d.parameters[
                (
                  {
                    fixfile: "fixpix",
                    illum: "illumcor",
                    fringe: "fringecor",
                  } as Record<string, string>
                )[s.role]
              ] === "yes")
        )
      : spec.inputs.filter(
          (input) => !showCalibration || !correctionFlags[input.name]
        )
  return (
    <TabsContent value="input" className="inspector-sections">
      <section className="inspector-section">
        <FieldGroup>
          {mainInputs.map((s) => slot(s))}
          {!mainInputs.length && (
            <p className="text-muted-foreground">입력이 없는 작업입니다.</p>
          )}
          {spec.name === "images.immatch.imalign" &&
            d.alignmentBinding &&
            Object.values(d.textInputs || {}).some((v) => v.trim()) &&
            (JSON.stringify(d.alignmentBinding.reference) !==
              JSON.stringify(assigned(map, task, "reference").ids) ||
              (!!d.textInputs?.shifts?.trim() &&
                JSON.stringify(d.alignmentBinding.input) !==
                  JSON.stringify(assigned(map, task, "input").ids))) && (
              <Alert>
                <AlertDescription>
                  영상 선택 또는 순서가 변경되었습니다. 좌표와 이동량의 행
                  순서를 확인해 주세요.
                  <Button
                    variant="outline"
                    onClick={() =>
                      edit((t) => ({
                        ...t,
                        draft: {
                          ...t.draft,
                          alignmentBinding: {
                            reference: assigned(map, task, "reference").ids,
                            input: assigned(map, task, "input").ids,
                          },
                        },
                      }))
                    }
                  >
                    현재 영상 기준으로 확인 완료
                  </Button>
                </AlertDescription>
              </Alert>
            )}
        </FieldGroup>
      </section>
      {specialized && spec.preprocess && (
        <section className="inspector-section">
          <FieldGroup>
            <Field className="parameter-field">
              <FieldLabel htmlFor="combine-process">process</FieldLabel>
              <Switch
                id="combine-process"
                checked={d.parameters.process === "yes"}
                onCheckedChange={(v) => change("process", v ? "yes" : "no")}
              />
            </Field>
          </FieldGroup>
        </section>
      )}
      {showCalibration && (
        <CalibrationControls
          task={spec.name}
          options={d.calibration}
          parameters={corrections}
          frames={mainFrames}
          candidates={Object.fromEntries(
            Object.keys(correctionFlags).map((role) => [
              role,
              selectedFrames(role),
            ])
          )}
          repair={(role) => {
            setExpanded((v) => ({ ...v, [role]: 5 }))
            requestAnimationFrame(() =>
              document.getElementById(`source-${role}`)?.focus()
            )
          }}
          pending={Object.fromEntries(
            Object.keys(correctionFlags).map((role) => [
              role,
              !!assigned(map, task, role).pending.length ||
                !!task.expressions[role],
            ])
          )}
          customMapping={
            !!(
              (task.mapping.exptime && task.mapping.exptime !== "EXPTIME") ||
              (task.mapping.subset && task.mapping.subset !== "FILTER")
            )
          }
          change={(value) =>
            edit((t) => ({
              ...t,
              draft: { ...t.draft, calibration: value },
            }))
          }
          changeParameter={changeCorrection}
          slot={(role) => (
            <FieldGroup>
              {displayPorts
                .filter((s) => s.role === role && !s.group)
                .map((input) => slot(input, true))}
            </FieldGroup>
          )}
          masters={Object.fromEntries(
            Object.keys(correctionFlags).map((role) => [
              role,
              map.tasks.filter(
                (t) =>
                  t.id !== task.id &&
                  t.task ===
                    {
                      zero: "zerocombine",
                      dark: "darkcombine",
                      flat: "flatcombine",
                    }[role]
              ),
            ])
          )}
          connectMaster={(role, id) => {
            const parent = map.tasks.find((t) => t.id === id)!
            const outputs = outputPorts(map, parent, catalog, allRows)
            const ports = displayPorts.filter(
              (p) => p.role === role && !p.group
            )
            for (const input of ports) {
              const output = outputs.find((p) =>
                groupEqual(p.group, input.group)
              )
              onInputSource?.(input.name, {
                kind: "pending",
                taskId: id,
                ...(input.group
                  ? {
                      group: input.group,
                      port: output?.handleId,
                      outputRole: output?.outputRole,
                    }
                  : {}),
              })
            }
          }}
        />
      )}
      {["imheader", "imstatistics"].includes(spec.name) && (
        <Field>
          <FieldLabel htmlFor="image-section">영상 영역</FieldLabel>
          <Input
            id="image-section"
            placeholder="[x1:x2,y1:y2]"
            value={d.section}
            onChange={(e) =>
              edit((t) => ({
                ...t,
                draft: { ...t.draft, section: e.target.value },
              }))
            }
          />
        </Field>
      )}
    </TabsContent>
  )
}
