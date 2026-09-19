import { RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Choice, ParameterHelp } from "./workbench-controls"
import type { Param, Values } from "@/lib/workbench"

const label = (p: Param) => p.name
export function ParamControl({
  p,
  value,
  onChange,
  id,
}: {
  p: Param
  value: unknown
  onChange: (value: string) => void
  id: string
}) {
  const v = String(value ?? "")
  return p.type === "b" ? (
    <Switch
      id={id}
      aria-label={label(p)}
      aria-describedby={`${id}-description`}
      aria-required={p.required || undefined}
      checked={v === "yes"}
      onCheckedChange={(v) => onChange(v ? "yes" : "no")}
    />
  ) : p.choices.length ? (
    <Choice
      id={id}
      label={label(p)}
      describedBy={`${id}-description`}
      required={p.required}
      value={v}
      options={p.choices.map((v) => ({ value: v, label: v }))}
      onChange={onChange}
    />
  ) : (
    <Input
      id={id}
      aria-label={label(p)}
      aria-describedby={`${id}-description`}
      aria-required={p.required || undefined}
      value={v}
      onChange={(e) => onChange(e.target.value)}
      inputMode={["i", "r", "d"].includes(p.type) ? "decimal" : undefined}
    />
  )
}
/** Kept as an export for the existing callers; parameters are edited as fields. */
export function ParameterTable({
  parameters,
  values,
  change,
  scope,
  filter = "",
  showInactive = false,
}: {
  parameters: Param[]
  values: Values
  change: (key: string, value: string) => void
  scope: string
  filter?: string
  showInactive?: boolean
}) {
  const dependencies: Record<string, string> = {
    biassec: "overscan",
    trimsec: "trim",
    function: "overscan",
    order: "overscan",
    sample: "overscan",
    naverage: "overscan",
    niterate: "overscan",
    low_reject: "overscan",
    high_reject: "overscan",
    grow: "overscan",
    interactive: "overscan",
    scantype: "scancor",
    nscan: "scancor",
  }
  const shown = parameters
    .filter(
      (p) =>
        showInactive ||
        !dependencies[p.name] ||
        values[dependencies[p.name]] !== "no"
    )
    .filter((p) =>
      [p.name, p.prompt, label(p)]
        .join(" ")
        .toLowerCase()
        .includes(filter.toLowerCase())
    )
  return (
    <FieldGroup className="parameter-fields">
      {shown.map((p) => {
        const changed =
            String(values[p.name] ?? p.default) !== String(p.default),
          id = `${scope}-${p.name}`
        return (
          <Field
            key={p.name}
            className="parameter-field"
            data-boolean={p.type === "b"}
          >
            <div className="parameter-label">
              <FieldLabel htmlFor={id}>
                {p.name}
                {p.required && <span aria-hidden="true">*</span>}
              </FieldLabel>
              {changed && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  title={`${p.name} 기본값 ${String(p.default ?? "") || "빈 값"}으로 초기화`}
                  aria-label={`${p.name} 초기화`}
                  onClick={() => change(p.name, String(p.default ?? ""))}
                >
                  <RotateCcw />
                </Button>
              )}
            </div>
            <ParamControl
              p={p}
              id={id}
              value={values[p.name] ?? p.default}
              onChange={(v) => change(p.name, v)}
            />
            <ParameterHelp p={p} id={`${id}-description`} />
          </Field>
        )
      })}
      {!shown.length && (
        <p className="text-muted-foreground">검색 결과가 없습니다</p>
      )}
    </FieldGroup>
  )
}
