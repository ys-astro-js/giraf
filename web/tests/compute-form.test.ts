import { expect, test } from "bun:test"
import { addTask, emptyMap, makeInstance, type Instance, type TaskMap } from "../src/lib/task-map"
import { connectFlow } from "../src/lib/workflow-flow"
import { computeInputs, formExpression, inputLabel, isFormNumber, nextInputName, parseForm, type ComputeForm } from "../src/lib/compute-form"
import { computeReads, computeVariables, expressionNames, pinnedKeys } from "../src/lib/values"
import { valueIssues } from "../src/lib/value-modes"
import type { Catalog, Preferences, Spec } from "../src/lib/workbench"

const form = (patch: Partial<ComputeForm>): ComputeForm => ({ input: "값", method: "median", times: "", plus: "", ...patch })

test("a form writes one expression shape and reads it back", () => {
  const cases: [ComputeForm, string][] = [
    [form({ times: "2.5", plus: "1" }), "median(값) * 2.5 + 1"],
    [form({ method: "" }), "값"],
    [form({ method: "stddev", times: "4" }), "stddev(값) * 4"],
    [form({ method: "count", plus: "-1" }), "count(값) - 1"],
    [form({ input: "fwhm", method: "", times: "-0.5", plus: "1e-3" }), "fwhm * -0.5 + 1e-3"],
  ]
  for (const [value, expression] of cases) {
    expect(formExpression(value)).toBe(expression)
    expect(parseForm(expression, ["값", "fwhm"])).toEqual(value)
  }
  // Spacing and a subtracted negative still read as the form.
  expect(parseForm("mean( 값 )*2+3", ["값"])).toEqual(form({ method: "mean", times: "2", plus: "3" }))
  expect(parseForm("max(값) - -2", ["값"])).toEqual(form({ method: "max", plus: "2" }))
  // No received value: no expression yet, and an empty expression is that form.
  expect(formExpression(form({ input: "", times: "2" }))).toBe("")
  expect(parseForm("  ", ["값"])).toEqual(form({ input: "" }))
})

test("expressions of another shape are not a form", () => {
  for (const expression of [
    "median(fwhm) * 4 + gain",
    "sqrt(값)",
    "2 * median(값)",
    "median(값) / 2",
    "median(값) + 1 * 2",
    "2.5",
    "median(값, 값2)",
    "(값)",
    "max(값) > 4",
  ])
    expect(parseForm(expression, ["값", "값2", "fwhm", "gain"])).toBeUndefined()
  // A name that is another row, not a received value.
  expect(parseForm("median(m)", ["값"])).toBeUndefined()
  expect(isFormNumber("-")).toBe(false)
  expect(isFormNumber("2.")).toBe(true)
  expect(isFormNumber("")).toBe(true)
})

const node = (name: string, run: Spec["run"], extra: Partial<Spec> = {}): Spec => ({
  name, title: name, taskName: name, package: "giraf", adapter: "generic", run, parameters: [], inputs: [], outputs: [], output: null, kind: "any", ...extra,
})
const daoedit: Spec = {
  name: "noao.digiphot.daophot.daoedit", title: "daoedit", taskName: "daoedit", package: "daophot", adapter: "generic",
  parameters: [], inputs: [{ name: "image", label: "image", kind: "image", multiple: false }],
  outputs: [{ name: "$stdout", kind: "text", default: "" }], output: null, kind: "text",
  values: [{ name: "fwhm", kind: "real", from: "$stdout", column: "FWHM" }],
}
const compute = node("giraf.compute", "value-compute")
const catalog: Catalog = { version: "test", tasks: [daoedit, compute], ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {} }
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const calc = (rows: { name: string; value: string }[]): Instance => {
  const task = makeInstance(compute, catalog, prefs, "calc")
  return { ...task, label: "계산", draft: { ...task.draft, valueRows: rows } }
}
const withCalc = (task: Instance): TaskMap => addTask(addTask(emptyMap(), { ...makeInstance(daoedit, catalog, prefs, "edit"), label: "daoedit" }), task)

test("a compute node offers 값 until its rows read a value", () => {
  expect(expressionNames("median(값2) * 2 + 1e5")).toEqual(["값2"])
  const empty = calc([])
  expect([computeReads(empty), computeVariables(empty)]).toEqual([[], ["값"]])
  // Rows that only hold numbers still leave 값 to connect.
  expect(computeVariables(calc([{ name: "k", value: "2.5" }]))).toEqual(["값"])
  expect(computeVariables(calc([{ name: "m", value: "median(fwhm)" }]))).toEqual(["fwhm"])
  expect(nextInputName(empty)).toBe("값")
  expect(nextInputName(calc([{ name: "m", value: "median(값)" }]))).toBe("값2")
  expect(nextInputName(calc([{ name: "값2", value: "median(값)" }]))).toBe("값3")

  // Connecting a value to 값 makes it a received value named by its source.
  let map = withCalc(empty)
  expect(pinnedKeys(map, catalog, map.tasks[1])).toEqual(["값"])
  expect(inputLabel(map, map.tasks[1], "값")).toBe("값")
  map = connectFlow(map, catalog, [], { source: "edit", sourceHandle: "value:fwhm", target: "calc", targetHandle: "p:값" })
  expect(inputLabel(map, map.tasks[1], "값")).toBe("daoedit fwhm")
  // A row that takes 값2 instead leaves 값 connected, still there to choose.
  map = { ...map, tasks: map.tasks.map((t) => (t.id === "calc" ? { ...t, draft: { ...t.draft, valueRows: [{ name: "m", value: "median(값2)" }] } } : t)) }
  expect(computeInputs(map, map.tasks[1])).toEqual(["값2", "값"])
})

test("a compute row asks for its received value through a warning", () => {
  const issues = (task: Instance, connect = false) => {
    let map = withCalc(task)
    if (connect) map = connectFlow(map, catalog, [], { source: "edit", sourceHandle: "value:fwhm", target: "calc", targetHandle: "p:값" })
    return valueIssues(map, catalog).map((i) => i.message)
  }
  expect(issues(calc([]))).toEqual([])
  expect(issues(calc([{ name: "m", value: "median(값)" }]))).toEqual(["받은 값을 연결해 주세요."])
  expect(issues(calc([{ name: "m", value: "median(값)" }]), true)).toEqual([])
  expect(issues(calc([{ name: "m", value: "" }]))).toEqual(["받은 값을 연결해 주세요."])
  expect(issues(calc([{ name: "m", value: "" }]), true)).toEqual(["받은 값을 골라 주세요."])
})
