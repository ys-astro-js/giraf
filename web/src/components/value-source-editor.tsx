import { useState } from "react"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Choice } from "@/components/workbench-controls"
import { psetSources, psetUser, VALUE_MODES } from "@/lib/value-modes"
import { taskDisplayName, type Catalog, type Spec } from "@/lib/workbench"
import type { Instance, TaskMap } from "@/lib/task-map"

/**
 * 가져오기: where a 값 node takes its values from. 작업 설정 also names the
 * task and pset it takes; until both are chosen the node holds none.
 */
export function ValueSourceEditor({
  map,
  catalog,
  spec,
  task,
  onMode,
  onPset,
}: {
  map: TaskMap
  catalog: Catalog
  spec: Spec
  task: Instance
  onMode: (run: NonNullable<Spec["run"]>) => void
  onPset: (taskId: string, name: string) => void
}) {
  // A task chosen whose pset is still to be picked.
  const [chosen, setChosen] = useState<string>()
  const sources = psetSources(map, catalog)
  const user = psetUser(map, task.id)
  const source = chosen ?? user?.taskId ?? ""
  const sets = sources.find((s) => s.task.id === source)?.sets ?? []
  const held = task.draft.pset?.name
  const pset = held && source === user?.taskId ? held : ""
  function chooseTask(id: string) {
    const next = sources.find((s) => s.task.id === id)
    // The same pset from another task applies at once.
    if (held && next?.sets.includes(held)) {
      setChosen(undefined)
      onPset(id, held)
    } else setChosen(id)
  }
  return (
    <section className="inspector-section" aria-label="가져오기">
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">가져오기</FieldLegend>
          <div className="segmented-choice">
            {VALUE_MODES.map((mode) => (
              <label key={mode.run}>
                <input
                  type="radio"
                  name={`value-source-${task.id}`}
                  value={mode.run}
                  checked={spec.run === mode.run}
                  onChange={() => {
                    setChosen(undefined)
                    onMode(mode.run)
                  }}
                />
                <span>{mode.label}</span>
              </label>
            ))}
          </div>
        </FieldSet>
        {spec.run === "pset" && (
          <div className="value-source-pair">
            <Field>
              <FieldLabel htmlFor="value-source-task">작업</FieldLabel>
              <Choice
                id="value-source-task"
                label="작업"
                value={source}
                options={sources.map((s) => ({
                  value: s.task.id,
                  label: s.task.label || taskDisplayName(s.task.task),
                }))}
                onChange={chooseTask}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="value-source-pset">pset</FieldLabel>
              <Choice
                id="value-source-pset"
                label="pset"
                value={pset}
                options={sets.map((name) => ({ value: name, label: name }))}
                onChange={(name) => {
                  setChosen(undefined)
                  onPset(source, name)
                }}
              />
            </Field>
          </div>
        )}
      </FieldGroup>
    </section>
  )
}
