import { useState } from "react"
import { ChevronDown, ChevronRight, Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Choice } from "@/components/workbench-controls"
import { PartitionField } from "@/components/value-rows-editor"
import { useValueResults } from "@/features/workflow/useValueResults"
import {
  COMPUTE_METHODS,
  computeInputs,
  DEFAULT_METHOD,
  formExpression,
  inputLabel,
  isFormNumber,
  nextInputName,
  parseForm,
  unconnectedInputs,
  type ComputeForm,
} from "@/lib/compute-form"
import { computeReads, expressionNames, formatValue } from "@/lib/values"
import type { Instance, TaskMap } from "@/lib/task-map"
import type { Catalog, ValueRow } from "@/lib/workbench"

// Select values for choices that have no expression text of their own.
const AS_IS = "as-is"
const NEW_INPUT = "new-input"

/**
 * The rows of a 계산 node. Each row is an easy form over its expression
 * (lib/compute-form); 식 직접 쓰기 shows the expression itself, and a row
 * whose expression the form cannot show opens there.
 */
export function ComputeRowsEditor({
  map,
  catalog,
  task,
  edit,
}: {
  map: TaskMap
  catalog: Catalog
  task: Instance
  edit: (fn: (t: Instance) => Instance) => void
}) {
  const { results } = useValueResults(map, catalog)
  const [expert, setExpert] = useState<Record<string, boolean>>({})
  const rows = task.draft.valueRows ?? []
  const inputs = computeInputs(map, task)
  const connected = inputs.filter((name) => !unconnectedInputs(map, task, [name]).length)
  // While no row reads a value, the offered 값 is already the new one.
  const fresh = computeReads(task).length ? nextInputName(task, inputs) : ""
  const inputOptions = [
    ...inputs.map((name) => ({ value: name, label: inputLabel(map, task, name) })),
    ...(fresh ? [{ value: NEW_INPUT, label: "새 값 받기" }] : []),
  ]
  const methodOptions = COMPUTE_METHODS.map((m) => ({ value: m.value || AS_IS, label: m.label }))
  const setRows = (next: ValueRow[]) => edit((t) => ({ ...t, draft: { ...t.draft, valueRows: next } }))
  const change = (index: number, patch: Partial<ValueRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const addRow = () =>
    setRows([...rows, { name: "", value: formExpression({ input: connected[0] ?? inputs[0], method: DEFAULT_METHOD, times: "", plus: "" }) }])

  return (
    <section className="inspector-section" aria-label="값">
      <FieldGroup>
        <PartitionField task={task} edit={edit} />
        {rows.map((row, index) => {
          const name = row.name || `${index + 1}행`
          const id = `compute-${task.id}-${index}`
          const form = parseForm(row.value, inputs)
          const open = !form || !!expert[id]
          const setForm = (patch: Partial<ComputeForm>) => {
            const next = { ...form!, ...patch }
            // A method or number chosen first takes the first received value.
            change(index, { value: formExpression({ ...next, input: next.input || inputs[0] }) })
          }
          const result = results?.outputs[`${task.id}:${row.name}`]
          // An unconnected value is the node's warning; other errors say why there is no value.
          const reads = expressionNames(row.value).filter((n) => inputs.includes(n))
          const error = result?.error !== undefined && !unconnectedInputs(map, task, reads).length ? result.error : ""
          const value = formatValue(result)
          return (
            <div key={index} className="value-compute-row" role="group" aria-label={name} data-parameter-key={row.name || undefined}>
              <div className="slot-entry">
                <Input
                  aria-label={`${index + 1}행 이름`}
                  className="font-mono"
                  value={row.name}
                  placeholder="이름"
                  onChange={(e) => change(index, { name: e.target.value.trim() })}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${name} 삭제`}
                  onClick={() => setRows(rows.filter((_, i) => i !== index))}
                >
                  <X />
                </Button>
              </div>
              {form && (
                <>
                  <div className="value-compute-pair">
                    <Field>
                      <FieldLabel htmlFor={`${id}-input`}>받은 값</FieldLabel>
                      <Choice
                        id={`${id}-input`}
                        label={`${name} 받은 값`}
                        value={form.input}
                        options={inputOptions}
                        onChange={(next) => setForm({ input: next === NEW_INPUT ? fresh : next })}
                      />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`${id}-method`}>계산 방법</FieldLabel>
                      <Choice
                        id={`${id}-method`}
                        label={`${name} 계산 방법`}
                        value={form.method || AS_IS}
                        options={methodOptions}
                        onChange={(next) => setForm({ method: next === AS_IS ? "" : next })}
                      />
                    </Field>
                  </div>
                  <div className="value-compute-scale">
                    <NumberField id={`${id}-times`} label={`${name} 곱하기`} sign="×" placeholder="1" value={form.times} onCommit={(times) => setForm({ times })} />
                    <NumberField id={`${id}-plus`} label={`${name} 더하기`} sign="+" placeholder="0" value={form.plus} onCommit={(plus) => setForm({ plus })} />
                    <output className="value-result" aria-label={`${name} 결과`} title={value || undefined}>
                      {value}
                    </output>
                  </div>
                </>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="value-expert-toggle"
                aria-expanded={open}
                aria-controls={open ? `${id}-expression` : undefined}
                disabled={!form}
                onClick={() => setExpert((e) => ({ ...e, [id]: !open }))}
              >
                {open ? <ChevronDown data-icon="inline-start" /> : <ChevronRight data-icon="inline-start" />}
                식 직접 쓰기
              </Button>
              {open && (
                <div id={`${id}-expression`} className="value-compute-expression">
                  <Input
                    aria-label={`${name} 식`}
                    className="font-mono"
                    value={row.value}
                    placeholder="식"
                    onChange={(e) => change(index, { value: e.target.value })}
                  />
                  {!form && (
                    <output className="value-result" aria-label={`${name} 결과`} title={value || undefined}>
                      {value}
                    </output>
                  )}
                </div>
              )}
              {error && <FieldError>{error}</FieldError>}
            </div>
          )
        })}
      </FieldGroup>
      <div>
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus data-icon="inline-start" />
          행 추가
        </Button>
      </div>
    </section>
  )
}

/**
 * × or + of the form. Text that is not a number yet (`-`, `1e`) stays in
 * the field and reaches the expression once it reads as one.
 */
function NumberField({
  id,
  label,
  sign,
  placeholder,
  value,
  onCommit,
}: {
  id: string
  label: string
  sign: string
  placeholder: string
  value: string
  onCommit: (value: string) => void
}) {
  const [text, setText] = useState(value)
  const [shown, setShown] = useState(value)
  // A new value from the expression replaces what is being typed.
  if (value !== shown) {
    setShown(value)
    if (!isFormNumber(text) || text.trim() !== value) setText(value)
  }
  return (
    <InputGroup>
      <InputGroupAddon align="inline-start">
        <label htmlFor={id}>{sign}</label>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        inputMode="decimal"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (isFormNumber(e.target.value)) onCommit(e.target.value.trim())
        }}
      />
    </InputGroup>
  )
}
