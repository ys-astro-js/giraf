import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import { Choice } from "@/components/workbench-controls"
import type { Instance, TaskMap } from "@/lib/task-map"
import type { Catalog, Frame, Spec } from "@/lib/workbench"
import {
  criteriaOf,
  flowKeywordChoices,
  isFlowSpec,
  loopFrames,
  passFilesText,
  regionRounds,
  splitChoices,
  type Criterion,
  type FlowSettings,
} from "@/lib/containers"

const NO_SPLIT = "$none"
const BY_NAME = "name"
const splitKey = (split: { taskId: string; outputRole?: string } | undefined) =>
  split ? `${split.taskId}\u0000${split.outputRole ?? ""}` : NO_SPLIT
const whole = (text: string) => {
  const value = Number(text)
  return text.trim() && Number.isInteger(value) && value >= 1 ? value : undefined
}

/**
 * What a loop region repeats by: its split files, its criteria and its
 * condition, with the rounds they make.
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
  const criteria = criteriaOf(task)
  const change = (patch: FlowSettings) =>
    edit((t) => ({ ...t, draft: { ...t.draft, flow: { ...t.draft.flow, ...patch } } }))
  /** Replace the criteria of one kind, keeping the others in their order. */
  const setKind = (is: (c: Criterion) => boolean, next: Criterion[]) => {
    const at = criteria.findIndex(is)
    const rest = criteria.filter((c) => !is(c))
    change({ criteria: at < 0 ? [...rest, ...next] : [...rest.slice(0, at), ...next, ...rest.slice(at)] })
  }
  const choices = flowKeywordChoices(map, catalog, task, rows)
  const chosen = criteria.flatMap((c) => ("keyword" in c ? [c.keyword] : []))
  // Keywords keep the list's order, so rounds read the same way every time.
  const toggle = (keyword: string, on: boolean) =>
    setKind((c) => "keyword" in c, choices.map((c) => c.keyword)
      .filter((k) => (k === keyword ? on : chosen.includes(k))).map((k) => ({ keyword: k })))
  const count = criteria.find((c): c is Extract<Criterion, { count: number }> => "count" in c)
  const times = criteria.find((c): c is Extract<Criterion, { times: number }> => "times" in c)
  const each = criteria.some((c) => "each" in c)
  const sources = splitChoices(map, task)
  const { rounds, waiting } = regionRounds(map, task, rows)
  const frames = loopFrames(map, rows)
  return (
    <section className="inspector-section" aria-label="무엇마다">
      <h3>무엇마다</h3>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="flow-split">나눌 파일</FieldLabel>
          <Choice
            id="flow-split"
            label="나눌 파일"
            value={splitKey(settings.split)}
            options={[
              { value: NO_SPLIT, label: "없음" },
              ...sources.map((s) => ({ value: splitKey(s), label: s.label })),
            ]}
            onChange={(value) => {
              const source = sources.find((s) => splitKey(s) === value)
              change({ split: source ? { taskId: source.taskId, ...(source.outputRole ? { outputRole: source.outputRole } : {}) } : undefined })
            }}
          />
        </Field>
        {choices.length ? (
          <div className="keyword-list" role="group" aria-label="헤더 키워드">
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
        <Field orientation="horizontal">
          <Checkbox
            id="flow-each"
            checked={each}
            onCheckedChange={(on) => setKind((c) => "each" in c, on ? [{ each: true }] : [])}
          />
          <FieldLabel htmlFor="flow-each">파일마다</FieldLabel>
        </Field>
        <Field>
          <FieldLabel htmlFor="flow-count">몇 장씩</FieldLabel>
          <Input
            id="flow-count"
            inputMode="numeric"
            value={count ? String(count.count) : ""}
            onChange={(e) => {
              const n = whole(e.target.value)
              setKind((c) => "count" in c, n ? [{ count: n, order: count?.order ?? BY_NAME }] : [])
            }}
          />
        </Field>
        {count && (
          <Field>
            <FieldLabel htmlFor="flow-order">순서</FieldLabel>
            <Choice
              id="flow-order"
              label="순서"
              value={count.order || BY_NAME}
              options={[
                { value: BY_NAME, label: "파일 이름" },
                ...choices.map((c) => ({ value: c.keyword, label: c.keyword })),
              ]}
              onChange={(order) => setKind((c) => "count" in c, [{ count: count.count, order }])}
            />
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="flow-times">몇 번</FieldLabel>
          <Input
            id="flow-times"
            inputMode="numeric"
            value={times ? String(times.times) : ""}
            onChange={(e) => {
              const n = whole(e.target.value)
              setKind((c) => "times" in c, n ? [{ times: Math.min(n, 1000) }] : [])
            }}
          />
        </Field>
        <Field data-parameter-key="condition">
          <FieldLabel htmlFor="flow-condition">조건에 맞는 파일만</FieldLabel>
          <Input
            id="flow-condition"
            className="font-mono"
            value={settings.condition ?? ""}
            placeholder="EXPTIME > 30"
            onChange={(e) => change({ condition: e.target.value })}
          />
        </Field>
        <FieldSet>
          <FieldLegend variant="label">회차</FieldLegend>
          <ul className="pass-files" aria-label="회차">
            {!rounds?.length ? (
              <li>
                <span className="pass-value">{waiting || !rounds ? "실행하면 정해집니다" : "나눌 파일이 없습니다"}</span>
              </li>
            ) : (
              rounds.map((round) => (
                <li key={round.name}>
                  <span>{round.name || "한 번"}</span>
                  {settings.split && <span className="pass-value">{passFilesText(round.ids, frames, false)}</span>}
                </li>
              ))
            )}
          </ul>
        </FieldSet>
      </FieldGroup>
    </section>
  )
}
