import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import type { Instance, TaskMap } from "@/lib/task-map"
import type { Catalog, Frame, Spec } from "@/lib/workbench"
import {
  flowKeywordChoices,
  flowKeywords,
  flowPasses,
  isFlowSpec,
  loopFrames,
  passFilesText,
  type FlowSettings,
} from "@/lib/containers"

const range: { key: "start" | "end" | "step"; label: string }[] = [
  { key: "start", label: "시작" },
  { key: "end", label: "끝" },
  { key: "step", label: "간격" },
]

/**
 * What a container repeats over: the 각각 반복 keywords, the 반복 range or the
 * 조건 분기 condition. A 각각 반복's list is its input connection.
 */
export function FlowSettingsEditor({
  spec,
  task,
  edit,
  map,
  catalog,
  rows,
}: {
  spec: Spec
  task: Instance
  edit: (fn: (t: Instance) => Instance) => void
  map: TaskMap
  catalog: Catalog
  rows: Frame[]
}) {
  if (!isFlowSpec(spec)) return null
  const settings = task.draft.flow ?? {}
  const change = (patch: FlowSettings) =>
    edit((t) => ({ ...t, draft: { ...t.draft, flow: { ...t.draft.flow, ...patch } } }))
  if (spec.run === "foreach")
    return <LoopKeywords task={task} map={map} catalog={catalog} rows={rows} change={change} />
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

/** 무엇마다: the header keywords the loop runs by, and the passes they make. */
function LoopKeywords({
  task,
  map,
  catalog,
  rows,
  change,
}: {
  task: Instance
  map: TaskMap
  catalog: Catalog
  rows: Frame[]
  change: (patch: FlowSettings) => void
}) {
  const chosen = flowKeywords(task)
  const choices = flowKeywordChoices(map, catalog, task, rows)
  const { passes, waiting } = flowPasses(map, catalog, task, rows)
  const frames = loopFrames(map, rows)
  // Keywords keep the list's order, so passes read the same way every time.
  const toggle = (keyword: string, on: boolean) =>
    change({ keywords: choices.map((c) => c.keyword).filter((k) => (k === keyword ? on : chosen.includes(k))) })
  return (
    <section className="inspector-section" aria-label="무엇마다">
      <h3>무엇마다</h3>
      <FieldGroup>
        {choices.length ? (
          <div className="keyword-list" role="group" aria-label="나눌 헤더 키워드">
            {choices.map(({ keyword, values }) => (
              <Field key={keyword} orientation="horizontal">
                <Checkbox
                  id={`loop-keyword-${keyword}`}
                  checked={chosen.includes(keyword)}
                  onCheckedChange={(on) => toggle(keyword, on)}
                />
                <FieldLabel htmlFor={`loop-keyword-${keyword}`}>
                  <span className="keyword-name font-mono">{keyword}</span>
                  <span className="keyword-values">{values.join(", ")}</span>
                </FieldLabel>
              </Field>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">{waiting ? "실행하면 정해집니다" : "고를 헤더 키워드가 없습니다"}</p>
        )}
        <FieldSet>
          <FieldLegend variant="label">회차</FieldLegend>
          <ul className="pass-files" aria-label="회차">
            {!passes.length ? (
              <li>
                <span className="pass-value">{waiting ? "실행하면 정해집니다" : "연결한 파일이 없습니다"}</span>
              </li>
            ) : !chosen.length ? (
              <li>
                <span>파일마다 한 번</span>
                <span className="pass-value">{passes.length}회</span>
              </li>
            ) : (
              passes.map((pass) => (
                <li key={pass.name}>
                  <span>{pass.name}</span>
                  <span className="pass-value">{passFilesText(pass.ids, frames, false)}</span>
                </li>
              ))
            )}
          </ul>
        </FieldSet>
      </FieldGroup>
    </section>
  )
}
