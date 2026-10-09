/**
 * The easy 계산 form of a compute row: one received value, a method, and an
 * optional `×` and `+`. The form is only a view of the row's expression
 * (`median(값) * 2.5 + 1`, or `값` for 그대로), so saved documents and
 * giraf/values.py see the same `name = expression` rows. An expression of
 * another shape is edited as text.
 */
import type { Instance, TaskMap } from "./task-map/model"
import { COMPUTE_INPUT, computeReads, computeVariables, PARAM_HANDLE, VALUE_HANDLE, valueLinksInto } from "./values"

/** 계산 방법 choices; `""` hands the value on as it is. */
export const COMPUTE_METHODS = [
  { value: "median", label: "중간값" },
  { value: "mean", label: "평균" },
  { value: "min", label: "최소" },
  { value: "max", label: "최대" },
  { value: "stddev", label: "표준편차" },
  { value: "sum", label: "합" },
  { value: "count", label: "개수" },
  { value: "", label: "그대로" },
] as const

/** The method a new row starts with. */
export const DEFAULT_METHOD = "median"

/** `times` and `plus` are number text; `""` leaves them out. */
export type ComputeForm = { input: string; method: string; times: string; plus: string }

const NAME = String.raw`[\p{L}_][\p{L}\p{N}_]*`
const NUMBER = String.raw`-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?`
const METHOD = COMPUTE_METHODS.map((m) => m.value).filter(Boolean).join("|")
const SHAPE = new RegExp(
  String.raw`^\s*(?:(${METHOD})\s*\(\s*(${NAME})\s*\)|(${NAME}))` +
    String.raw`(?:\s*\*\s*(${NUMBER}))?(?:\s*([+-])\s*(${NUMBER}))?\s*$`,
  "u"
)

/** Number text the form can write into an expression: empty, or a finite number. */
export const isFormNumber = (text: string) => !text.trim() || new RegExp(`^${NUMBER}$`).test(text.trim())

/** The expression a form stands for; without a received value it is empty. */
export function formExpression(form: ComputeForm): string {
  if (!form.input) return ""
  const times = form.times.trim(), plus = form.plus.trim()
  const base = form.method ? `${form.method}(${form.input})` : form.input
  const scaled = times ? `${base} * ${times}` : base
  if (!plus) return scaled
  return plus.startsWith("-") ? `${scaled} - ${plus.slice(1)}` : `${scaled} + ${plus}`
}

/**
 * The form an expression stands for, or `undefined` when it has another
 * shape or reads a name that is not one of `inputs` (another row).
 * An empty expression is a form whose received value is not chosen yet.
 */
export function parseForm(expression: string, inputs: string[]): ComputeForm | undefined {
  if (!expression.trim()) return { input: "", method: DEFAULT_METHOD, times: "", plus: "" }
  const match = expression.match(SHAPE)
  if (!match) return undefined
  const [, method = "", called, bare, times = "", sign, plus = ""] = match
  const input = called ?? bare
  if (!inputs.includes(input)) return undefined
  const signed = !plus ? "" : sign === "-" ? (plus.startsWith("-") ? plus.slice(1) : `-${plus}`) : plus
  return { input, method, times, plus: signed }
}

/** A name for one more received value: `값`, else `값2`, `값3`; `inputs` are taken too. */
export function nextInputName(task: Instance, inputs: string[] = []): string {
  const taken = new Set([...computeReads(task), ...inputs, ...(task.draft.valueRows ?? []).map((r) => r.name)])
  for (let n = 1; ; n++) {
    const name = n === 1 ? COMPUTE_INPUT : `${COMPUTE_INPUT}${n}`
    if (!taken.has(name)) return name
  }
}

/**
 * The values a compute row can take: the node's inputs, then values still
 * connected to inputs no row reads any more, so a row can take them back.
 */
export function computeInputs(map: TaskMap, task: Instance): string[] {
  const linked = valueLinksInto(map, task.id).map((c) => c.role.slice(PARAM_HANDLE.length))
  return [...new Set([...computeVariables(task), ...linked])]
}

/** The node and output connected to a compute input, as `daoedit fwhm`; else the input's name. */
export function inputLabel(map: TaskMap, task: Instance, input: string): string {
  const source = map.connections.find((c) => c.target === task.id && c.role === PARAM_HANDLE + input)?.source
  if (!source || source.kind === "files" || !source.outputRole?.startsWith(VALUE_HANDLE)) return input
  const node = map.tasks.find((t) => t.id === source.taskId)
  return `${node?.label ?? "삭제된 노드"} ${source.outputRole.slice(VALUE_HANDLE.length)}`
}

/** Compute inputs a row reads that nothing is connected to. */
export function unconnectedInputs(map: TaskMap, task: Instance, reads: string[]): string[] {
  return reads.filter((name) => !map.connections.some((c) => c.target === task.id && c.role === PARAM_HANDLE + name))
}
