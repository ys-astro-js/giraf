import { expect, test } from "bun:test"
import catalogJson from "./fixtures/regions/catalog.json"
import { applyCommandEdit, commandIssues } from "../src/lib/command-edit"
import type { ParsedLine } from "../src/lib/command-workflow"
import { emptyMap, makeInstance } from "../src/lib/task-map"
import type { Catalog, Preferences } from "../src/lib/workbench"

const catalog = catalogJson as unknown as Catalog
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const dark = catalog.tasks.find((t) => t.name === "darkcombine")!
const phot = catalog.tasks.find((t) => t.name === "noao.digiphot.daophot.phot")!
// What the server reads from a line (giraf/command_parse.py, resolve=false).
const line = (parameters: Record<string, string>, extra: Partial<ParsedLine> = {}): ParsedLine => ({
  index: 0, line: 1, text: "darkcombine", kind: "task", task: "darkcombine", taskName: "darkcombine", issues: [],
  parameters, parameterSets: {}, preprocess: {}, packageValues: {},
  inputs: { input: { text: "@input.list", items: [] } }, outputs: { output: { text: "Dark", value: "Dark", labels: [] } }, ...extra,
})

test("an edited line sets what changed, and a parameter left out goes back to its default", () => {
  const task = makeInstance(dark, catalog, prefs)
  task.draft.parameters.combine = "median"
  const after = applyCommandEdit(task, dark, catalog, line({ combine: "median", reject: "none" }), line({ reject: "avsigclip", gain: "1.4" }))
  expect(after.draft.parameters).toMatchObject({ combine: "average", reject: "avsigclip", gain: "1.4" })
  expect(after.commandIssues).toBeUndefined()
  // A single output's name may change; a different input is not rewired.
  const renamed = applyCommandEdit(task, dark, catalog, line({}), line({}, {
    outputs: { output: { text: "Master", value: "Master", labels: [] } },
    inputs: { input: { text: "@other.list", items: [] } },
  }))
  expect(renamed.draft.output.name).toBe("Master")
  expect(renamed.commandIssues).toEqual(["input: 연결된 입력과 다른 이름입니다. 입력은 노드의 연결로 바꾸세요."])
  expect(commandIssues({ ...emptyMap(), tasks: [renamed] }).map((i) => [i.nodeId, i.severity])).toEqual([[task.id, "warning"]])
})

test("a group's line changes that group's value; a value all groups share is the shared one", () => {
  const task = makeInstance(dark, catalog, prefs)
  task.draft.parameters.combine = "median"
  const groups = ["15", "30"]
  const one = applyCommandEdit(task, dark, catalog, line({ combine: "median" }), line({ combine: "average" }), { id: "15", groups })
  expect(one.draft.parameters.combine).toBe("median")
  expect(one.draft.groupValues).toEqual({ combine: { "15": "average" } })
  const both = applyCommandEdit(one, dark, catalog, line({ combine: "median" }), line({ combine: "average" }), { id: "30", groups })
  expect(both.draft.parameters.combine).toBe("average")
  expect(both.draft.groupValues).toEqual({})
  // Back to the shared value drops the group's own.
  const back = applyCommandEdit(one, dark, catalog, line({ combine: "average" }), line({ combine: "median" }), { id: "15", groups })
  expect(back.draft.groupValues).toEqual({})
  // Output names of a group are the group's; they change in the 출력 tab.
  const output = applyCommandEdit(task, dark, catalog, line({}), line({}, { outputs: { output: { text: "X15", value: "X15", labels: [] } } }), { id: "15", groups })
  expect(output.commandIssues).toEqual(["output: 이 출력 이름은 출력 탭에서 바꾸세요."])
})

test("pset parameters go to the pset, per group as `pset.name`; a parse problem changes nothing", () => {
  const task = makeInstance(phot, catalog, prefs)
  const base = (values: Record<string, string>): ParsedLine => ({ ...line({}), task: phot.name, parameterSets: { datapars: values }, inputs: {}, outputs: {} })
  const shared = applyCommandEdit(task, phot, catalog, base({}), base({ fwhmpsf: "7.8" }))
  expect(shared.parameterSets?.datapars?.fwhmpsf).toBe("7.8")
  const grouped = applyCommandEdit(task, phot, catalog, base({}), base({ fwhmpsf: "8.6" }), { id: "V", groups: ["B", "V"] })
  expect(grouped.draft.groupValues).toEqual({ "datapars.fwhmpsf": { V: "8.6" } })
  const broken = applyCommandEdit(task, phot, catalog, base({}), { ...base({ fwhmpsf: "1" }), issues: ["nosuch: 없는 파라미터입니다."] })
  expect([broken.parameterSets, broken.commandIssues]).toEqual([task.parameterSets, ["nosuch: 없는 파라미터입니다."]])
})
