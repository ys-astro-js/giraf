import { useState } from "react"
import { Plus, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
  splitFiles,
  type Criterion,
  type FlowSettings,
  type KeywordChoice,
} from "@/lib/containers"

const NO_SPLIT = "$none"
const BY_NAME = "name"
const splitKey = (split: { taskId: string; outputRole?: string } | undefined) =>
  split ? `${split.taskId}\u0000${split.outputRole ?? ""}` : NO_SPLIT
const whole = (text: string) => {
  const value = Number(text)
  return text.trim() && Number.isInteger(value) && value >= 1 ? value : undefined
}
const KIND: Record<string, string> = { keyword: "헤더 키워드", expression: "식", count: "N장씩", each: "파일마다", times: "N번" }
const kindOf = (c: Criterion) => ("keyword" in c ? "keyword" : "expression" in c ? "expression" : "count" in c ? "count" : "each" in c ? "each" : "times")

/** A whole number of 1 or more; other text waits while typed and goes back when left. */
function WholeInput({ id, label, value, onChange }: { id: string; label: string; value: number; onChange: (n: number) => void }) {
  const [text, setText] = useState<string>()
  return (
    <Input
      id={id}
      aria-label={label}
      className="criterion-number"
      inputMode="numeric"
      value={text ?? String(value)}
      onChange={(e) => {
        setText(e.target.value)
        const n = whole(e.target.value)
        if (n) onChange(n)
      }}
      onBlur={() => setText(undefined)}
    />
  )
}

/** `15 10장, 30 10장`: a keyword's values with how many split files have each. */
const valuesText = (choice: KeywordChoice | undefined) =>
  choice?.values.map((v, i) => `${v} ${choice.counts[i]}장`).join(", ") ?? ""

/**
 * What a loop region repeats by (docs/node-structure-brief.md §3.5): the
 * files it divides, its criteria as rows, its condition, and the rounds they
 * make.
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
  const setCriteria = (next: Criterion[]) => change({ criteria: next })
  const replace = (at: number, next: Criterion) => setCriteria(criteria.map((c, i) => (i === at ? next : c)))
  const add = (next: Criterion) => setCriteria([...criteria, next])
  const choices = flowKeywordChoices(map, catalog, task, rows)
  const chosen = criteria.flatMap((c) => ("keyword" in c ? [c.keyword] : []))
  const shown = choices.filter((c) => !c.folded)
  const folded = choices.filter((c) => c.folded)
  const sources = splitChoices(map, task)
  const { waiting: splitWaiting } = splitFiles(map, task)
  const { rounds, waiting } = regionRounds(map, task, rows)
  const frames = loopFrames(map, rows)
  const keywordItem = (choice: KeywordChoice) => (
    <DropdownMenuItem
      key={choice.keyword}
      disabled={chosen.includes(choice.keyword)}
      title={choice.same.length ? choice.same.join(", ") : undefined}
      onClick={() => add({ keyword: choice.keyword })}
    >
      <span className="font-mono">{choice.keyword}</span>
      <span className="criterion-menu-values">{choice.values.join(", ")}</span>
    </DropdownMenuItem>
  )
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
        {!!criteria.length && (
          <ul className="criteria-rows" aria-label="기준">
            {criteria.map((criterion, at) => {
              const kind = kindOf(criterion)
              const id = `flow-criterion-${at}`
              return (
                <li key={at}>
                  <span className="criterion-kind">{KIND[kind]}</span>
                  <span className="criterion-fields">
                    {"keyword" in criterion && (
                      <Input
                        id={id}
                        aria-label={`${at + 1}번째 기준 헤더 키워드`}
                        className="font-mono"
                        value={criterion.keyword}
                        onChange={(e) => replace(at, { keyword: e.target.value.trim().toUpperCase() })}
                      />
                    )}
                    {"expression" in criterion && (
                      <>
                        <Input
                          id={id}
                          aria-label={`${at + 1}번째 기준 식`}
                          className="font-mono"
                          value={criterion.expression}
                          onChange={(e) => replace(at, { expression: e.target.value, name: criterion.name })}
                        />
                        <Input
                          aria-label={`${at + 1}번째 기준 이름`}
                          className="criterion-name"
                          value={criterion.name}
                          placeholder="이름"
                          onChange={(e) => replace(at, { expression: criterion.expression, name: e.target.value.trim() })}
                        />
                      </>
                    )}
                    {"count" in criterion && (
                      <>
                        <WholeInput
                          id={id}
                          label={`${at + 1}번째 기준 장수`}
                          value={criterion.count}
                          onChange={(n) => replace(at, { count: n, order: criterion.order })}
                        />
                        <Choice
                          id={`${id}-order`}
                          label={`${at + 1}번째 기준 순서`}
                          value={criterion.order || BY_NAME}
                          options={[
                            { value: BY_NAME, label: "파일 이름 순" },
                            ...choices.map((c) => ({ value: c.keyword, label: `${c.keyword} 순` })),
                          ]}
                          onChange={(order) => replace(at, { count: criterion.count, order })}
                        />
                      </>
                    )}
                    {"times" in criterion && (
                      <WholeInput
                        id={id}
                        label={`${at + 1}번째 기준 횟수`}
                        value={criterion.times}
                        onChange={(n) => replace(at, { times: Math.min(n, 1000) })}
                      />
                    )}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`${at + 1}번째 기준 빼기`}
                    title="빼기"
                    onClick={() => setCriteria(criteria.filter((_, i) => i !== at))}
                  >
                    <X />
                  </Button>
                  {"keyword" in criterion && (
                    <span className="criterion-values">{valuesText(choices.find((c) => c.keyword === criterion.keyword))}</span>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        <div className="criteria-add" role="group" aria-label="기준 추가">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Plus data-icon="inline-start" />
              헤더 키워드
            </DropdownMenuTrigger>
            <DropdownMenuContent className="criterion-menu">
              {!choices.length && <DropdownMenuLabel>{splitWaiting ? "실행하면 정해집니다" : "헤더 키워드가 없습니다"}</DropdownMenuLabel>}
              {shown.map(keywordItem)}
              {!!folded.length && (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>더 보기</DropdownMenuSubTrigger>
                  <DropdownMenuContent className="criterion-menu">{folded.map(keywordItem)}</DropdownMenuContent>
                </DropdownMenuSub>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => add({ keyword: "" })}>직접 입력</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="outline" size="sm" onClick={() => add({ expression: "", name: "" })}>
            <Plus data-icon="inline-start" />식
          </Button>
          <Button variant="outline" size="sm" disabled={criteria.some((c) => "count" in c)} onClick={() => add({ count: 5, order: BY_NAME })}>
            <Plus data-icon="inline-start" />N장씩
          </Button>
          <Button variant="outline" size="sm" disabled={criteria.some((c) => "each" in c)} onClick={() => add({ each: true })}>
            <Plus data-icon="inline-start" />파일마다
          </Button>
          <Button variant="outline" size="sm" disabled={criteria.some((c) => "times" in c)} onClick={() => add({ times: 3 })}>
            <Plus data-icon="inline-start" />N번
          </Button>
        </div>
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
