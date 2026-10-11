import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { CommandLine, markedRuns, type CommandIssue } from "../src/features/inspector/CommandLine"
import { CommandList } from "../src/features/inspector/SplitSections"
import type { FieldIssue } from "../src/lib/diagnostics"
import type { Instance } from "../src/lib/task-map"
import type { Catalog, Spec } from "../src/lib/workbench"

const text = "imcombine @input.list output=Bias.fits combine=median"
const message = "input.list: 목록 파일이 없습니다."
const issue: CommandIssue = { name: "input", start: 10, end: 21, severity: "error", message }
const task = { id: "n", label: "imcombine", task: "images.immatch.imcombine" } as unknown as Instance
const spec = { name: "images.immatch.imcombine" } as unknown as Spec
const catalog = { tasks: [spec] } as unknown as Catalog
const visible = (html: string) => html.replace(/<[^>]*>/g, "")
const tokens = [{ name: "input", start: 10, end: 21 }, { name: "output", start: 29, end: 38 }, { name: "combine", start: 47, end: 53 }]

test("a line whose input list is missing still reads as its line, the field's token marked and no error text", () => {
  const issues = new Map<string, FieldIssue>([["input", { severity: "error", message }]])
  const html = renderToStaticMarkup(<CommandList groups={[{ id: "", name: "", files: [], lines: [{ text, tokens }] }]} catalog={catalog} task={task} issues={issues} />)
  expect(visible(html)).toBe("명령" + text)
  expect(html).toMatch(/<mark class="command-issue" data-severity="error"[^>]*>@input.list<\/mark>/)
  // A field with no problem, or a problem with no field, marks nothing.
  expect(renderToStaticMarkup(<CommandList groups={[{ id: "", name: "", files: [], lines: [{ text, tokens }] }]} catalog={catalog} task={task} issues={new Map()} />)).not.toContain("<mark")
})

test("the editable line marks its token until it is edited", () => {
  const html = renderToStaticMarkup(<CommandLine line={text} issues={[issue, { ...issue, severity: "warning", message: "input: 다른 문제" }]}
    task={task} spec={spec} catalog={catalog} edit={() => {}} />)
  expect(html).toContain('role="textbox"')
  expect(html).toMatch(/<mark class="command-issue" data-severity="error"[^>]*>@input.list<\/mark>/)
  expect(visible(html)).toBe(text)
  expect(renderToStaticMarkup(<CommandLine line={text} task={task} spec={spec} catalog={catalog} edit={() => {}} />)).toContain("<textarea")
})

test("runs split the line at the marked tokens", () => {
  const warning: CommandIssue = { name: "combine", start: 47, end: 53, severity: "warning", message: "combine: 확인" }
  expect(markedRuns(text, [warning, issue]).map((r) => [r.text, r.issues.length])).toEqual([
    ["imcombine ", 0], ["@input.list", 1], [" output=Bias.fits combine=", 0], ["median", 1],
  ])
  expect(markedRuns(text, [])).toEqual([{ text, issues: [] }])
})

test("no line, no section", () => {
  expect(renderToStaticMarkup(<CommandList groups={[{ id: "", name: "", files: [], lines: [] }]} catalog={catalog} task={task} issues={new Map()} />)).toBe("")
})
