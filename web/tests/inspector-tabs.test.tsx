import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TaskInspector } from "../src/components/task-inspector"
import { emptyMap, makeInstance } from "../src/lib/task-map"
import type { Catalog, Spec, Preferences } from "../src/lib/workbench"
const spec: Spec = {
  name: "custom.task",
  package: "custom",
  title: "Task",
  adapter: "generic",
  kind: "image",
  parameters: [
    {
      name: "gain",
      type: "s",
      default: "1",
      prompt: "Detector gain",
      choices: [],
      min: "",
      max: "",
    },
  ],
  inputs: [
    { name: "input", label: "Images", kind: "image", multiple: true },
    {
      name: "optional",
      label: "Optional images",
      kind: "image",
      multiple: true,
      optional: true,
    },
  ],
  output: null,
  outputs: [{ name: "output", kind: "image", default: "out.fits" }],
}
const catalog: Catalog = {
  version: "test",
  tasks: [spec],
  ccdproc: { parameters: [], inputs: [] },
  ccdred: [],
  exam: {},
}
const prefs: Preferences = {
  drafts: {},
  backend: "cl",
  mapping: { exptime: "EXPTIME", subset: "FILTER" },
  instrument: [],
  packageValues: {},
}
const noop = () => {}
function render(activeTab: string, changed = false) {
  const task = makeInstance(spec, catalog, prefs, "test")
  if (changed) task.draft.parameters.gain = "2"
  return renderToStaticMarkup(
    <TaskInspector
      catalog={catalog}
      task={task}
      map={{ ...emptyMap(), tasks: [task] }}
      rows={[]}
      edit={noop}
      pick={noop}
      onOpen={noop}
      onRun={noop}
      busy={false}
      error=""
      onErrorFocus={noop}
      saveDefaults={noop}
      onRemove={noop}
      reorderInput={noop}
      activeTab={activeTab}
    />
  )
}
test("inspector exposes five named icon tabs and information without disclosures", () => {
  const html = render("info", true)
  for (const name of ["정보", "입력", "출력", "의존성", "설정"])
    expect(html).toContain(`class="sr-only">${name}</span>`)
  expect(html).toContain("custom.task")
  expect(html).toContain("task.gain")
  expect(html).toContain("<dd>2</dd>")
  expect(html).not.toContain("<details")
  expect(html).toContain('aria-label="작업 삭제"')
  expect(html).toContain('aria-label="IRAF 도움말"')
  expect(html).not.toContain("parameter-search")
})
test("information gives an explicit unchanged state", () => {
  expect(render("info")).toContain("변경한 파라미터가 없습니다.")
})
test("input tab includes optional inputs and excludes output settings", () => {
  const html = render("input")
  expect(html).not.toContain("<h3>입력</h3>")
  expect(html).toContain("source-input")
  expect(html).toContain("source-optional")
  expect(html).not.toContain("generic-output-output")
})
test("output tab contains output names, ports and results", () => {
  const html = render("output")
  expect(html).toContain("generic-output-output")
  expect(html).not.toContain("<h3>출력</h3>")
  expect(html).toContain("포트 추가")
  expect(html).not.toContain("source-input")
})
test("settings expose catalog parameters with search without synthetic mapping or changed filter", () => {
  const html = render("settings")
  expect(html).toContain("parameter-search")
  expect(html).not.toContain("parameter-changed")
  expect(html).not.toContain("헤더 매핑")
  expect(html).not.toContain("editor-mapping-")
  expect(html).toContain("editor-task-gain")
  expect(html).not.toContain("전체 설정")
  expect(html).not.toContain("source-input")
  expect(html).not.toContain("generic-output-output")
})

test("dependencies tab sits immediately before settings and opens the node flow", () => {
  const html = render("dependencies")
  expect(html.indexOf('class="sr-only">의존성</span>')).toBeLessThan(
    html.indexOf('class="sr-only">설정</span>')
  )
  expect(html).toContain("lucide-route")
  expect(html).toContain('aria-label="노드 의존성"')
  expect(html).not.toContain("parameter-search")
})
