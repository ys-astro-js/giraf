import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import type { Instance } from "@/lib/task-map"
import type { Spec } from "@/lib/workbench"
import { isFlowSpec, type FlowSettings } from "@/lib/containers"

const range: { key: "start" | "end" | "step"; label: string }[] = [
  { key: "start", label: "시작" },
  { key: "end", label: "끝" },
  { key: "step", label: "간격" },
]

/**
 * What a container repeats over: the 반복 range or the 조건 분기 condition.
 * 각각 반복 needs nothing here; its list is its input connection.
 */
export function FlowSettingsEditor({
  spec,
  task,
  edit,
}: {
  spec: Spec
  task: Instance
  edit: (fn: (t: Instance) => Instance) => void
}) {
  if (!isFlowSpec(spec) || spec.run === "foreach") return null
  const settings = task.draft.flow ?? {}
  const change = (patch: FlowSettings) =>
    edit((t) => ({ ...t, draft: { ...t.draft, flow: { ...t.draft.flow, ...patch } } }))
  return (
    <section className="inspector-section" aria-label={spec.title}>
      <FieldGroup>
        {spec.run === "for" &&
          range.map(({ key, label }) => (
            <Field key={key} data-parameter-key={key}>
              <FieldLabel htmlFor={`flow-${key}`}>{label}</FieldLabel>
              <Input
                id={`flow-${key}`}
                className="font-mono"
                inputMode="decimal"
                value={settings[key] ?? ""}
                onChange={(e) => change({ [key]: e.target.value.trim() })}
              />
            </Field>
          ))}
        {spec.run === "if" && (
          <Field data-parameter-key="condition">
            <FieldLabel htmlFor="flow-condition">조건</FieldLabel>
            <Input
              id="flow-condition"
              className="font-mono"
              value={settings.condition ?? ""}
              placeholder="EXPTIME > 30"
              onChange={(e) => change({ condition: e.target.value })}
            />
          </Field>
        )}
      </FieldGroup>
    </section>
  )
}
