import { Columns3, LocateFixed, Pin, PinOff, RotateCcw, Sigma, Variable } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Choice, ParameterHelp } from "./workbench-controls"
import type { Param, Values } from "@/lib/workbench"
import { TvmarkParameterControl } from "./tvmark-parameter-control"
import { takesValue } from "@/lib/value-take"

const label = (p: Param) => p.label || p.name
export function ParamControl({
  p,
  value,
  onChange,
  id,
  task,
}: {
  p: Param
  value: unknown
  onChange: (value: string) => void
  id: string
  task?: string
}) {
  const v = String(value ?? "")
  if (task === "images.tv.tvmark" && ["mark", "color", "frame", "pointsize", "txsize", "nxoffset", "nyoffset", "tolerance"].includes(p.name)) {
    return <TvmarkParameterControl name={p.name} value={v} onChange={onChange} id={id} />
  }
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
/** Pinning parameters to the node; a connected parameter shows its source instead of a control. */
export type ParameterPinning = {
  pinned: (key: string) => boolean
  /** A parameter connected on this node stays pinned until it is disconnected. */
  locked: (key: string) => boolean
  linked: (key: string) => string | undefined
  toggle: (key: string) => void
  /** The node a connected parameter takes its value from. */
  source?: (key: string) => { id: string; label: string } | undefined
  /** 다른 값에서 가져오기: a new 값 node feeds the parameter. */
  take?: (key: string) => void
  select?: (id: string) => void
  /** A split task's groups (lib/splits): a parameter may hold a value per group. */
  groups?: { id: string; name: string }[]
  grouped?: (key: string) => Record<string, string> | undefined
  setGrouped?: (key: string, values: Record<string, string> | undefined) => void
  /** A formula of the task's other parameters (`3 * fwhmpsf`). */
  formula?: (key: string) => string | undefined
  setFormula?: (key: string, text: string | undefined) => void
}
/** Kept as an export for the existing callers; parameters are edited as fields. */
export function ParameterTable({
  parameters,
  values,
  change,
  scope,
  filter = "",
  showInactive = false,
  task,
  keyPrefix,
  pinning,
}: {
  parameters: Param[]
  values: Values
  change: (key: string, value: string) => void
  scope: string
  filter?: string
  showInactive?: boolean
  task?: string
  /** Parameters can be pinned under `keyPrefix + name` (`name` or `pset.name`). */
  keyPrefix?: string
  pinning?: ParameterPinning
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
        const key = pinning && keyPrefix !== undefined ? keyPrefix + p.name : undefined
        const linked = key ? pinning!.linked(key) : undefined
        const locked = !!key && pinning!.locked(key)
        const pinned = !!key && (locked || pinning!.pinned(key))
        const source = key ? pinning!.source?.(key) : undefined
        const groups = pinning?.groups ?? []
        const grouped = key && !linked ? pinning!.grouped?.(key) : undefined
        const formula = key && !linked ? pinning!.formula?.(key) : undefined
        const numeric = ["i", "r", "d"].includes(p.type)
        const current = String(values[p.name] ?? p.default ?? "")
        return (
          <Field
            key={p.name}
            className="parameter-field"
            data-boolean={p.type === "b" && !linked}
            data-parameter-key={key}
          >
            <div className="parameter-label">
              <FieldLabel htmlFor={id} title={p.label ? p.name : undefined}>
                {label(p)}
                {p.required && <span aria-hidden="true">*</span>}
              </FieldLabel>
              <span className="parameter-actions">
              {source && pinning!.select ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${source.label} 노드 선택`}
                  title={`${source.label} 노드 선택`}
                  onClick={() => pinning!.select!(source.id)}
                >
                  <LocateFixed />
                </Button>
              ) : key && !source && pinning!.take && takesValue(p) ? (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${p.name} 다른 값에서 가져오기`}
                  title="다른 값에서 가져오기"
                  onClick={() => pinning!.take!(key)}
                >
                  <Variable />
                </Button>
              ) : null}
              {key && !linked && groups.length > 1 && pinning!.setGrouped && formula === undefined && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${p.name} 그룹마다 다른 값`}
                  aria-pressed={!!grouped}
                  title={grouped ? "모든 그룹에 같은 값" : "그룹마다 다른 값"}
                  onClick={() => pinning!.setGrouped!(key, grouped ? undefined : Object.fromEntries(groups.map((g) => [g.id, current])))}
                >
                  <Columns3 />
                </Button>
              )}
              {key && !linked && numeric && pinning!.setFormula && !grouped && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${p.name} 식`}
                  aria-pressed={formula !== undefined}
                  title={formula !== undefined ? "값으로 정하기" : "식으로 정하기"}
                  onClick={() => pinning!.setFormula!(key, formula !== undefined ? undefined : "")}
                >
                  <Sigma />
                </Button>
              )}
              {key && (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`${p.name} 노드에 고정`}
                  aria-pressed={pinned}
                  title={pinned ? "노드에서 고정 해제" : "노드에 고정"}
                  disabled={locked}
                  onClick={() => pinning!.toggle(key)}
                >
                  {pinned ? <PinOff /> : <Pin />}
                </Button>
              )}
              {changed && !linked && (
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
              </span>
            </div>
            {linked ? (
              <Input id={id} value={linked} readOnly aria-label={label(p)} aria-describedby={`${id}-description`} />
            ) : formula !== undefined ? (
              <Input
                id={id}
                className="font-mono"
                aria-label={`${label(p)} 식`}
                aria-describedby={`${id}-description`}
                placeholder="3 * fwhmpsf"
                value={formula}
                onChange={(e) => pinning!.setFormula!(key!, e.target.value)}
              />
            ) : grouped ? (
              <ul className="input-files pass-files group-inputs" aria-label={`${label(p)} 그룹마다`}>
                {groups.map((g) => (
                  <li key={g.id}>
                    <span className="partition-chip" data-filter={g.name}>{g.name}</span>
                    <ParamControl
                      task={task}
                      p={{ ...p, label: `${label(p)} ${g.name}` }}
                      id={`${id}-${g.id}`}
                      value={grouped[g.id] ?? current}
                      onChange={(v) => pinning!.setGrouped!(key!, { ...grouped, [g.id]: v })}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <ParamControl
                task={task}
                p={p}
                id={id}
                value={values[p.name] ?? p.default}
                onChange={(v) => change(p.name, v)}
              />
            )}
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
