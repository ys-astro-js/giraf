import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ReactFlowProvider } from "@xyflow/react"
import { createDiagnosticStore, fieldIssues } from "../src/lib/diagnostics"
import { ParameterTable } from "../src/components/parameter-fields"
import { InspectorFileSource } from "../src/features/inspector/FileSource"
import { CommandList, tokenIssues } from "../src/features/inspector/SplitSections"
import { TaskNode } from "../src/features/workflow/TaskNode"
import { WorkflowContext } from "../src/features/workflow/context"
import { addTask, emptyMap, makeInstance } from "../src/lib/task-map"
import { flowNodes, type TaskFlowNode } from "../src/lib/workflow-flow"
import type { Catalog, Param, Preferences, Spec } from "../src/lib/workbench"

const images = "input.list: 목록 파일이 없습니다."
const cache = "max_cache: 유효한 수치와 범위를 입력해 주세요."
const maxCache: Param = { name: "max_cache", type: "i", default: 0, prompt: "Maximum image caching memory", choices: [], min: "0", max: "" }
const spec: Spec = {
  name: "ccdproc", title: "ccdproc", package: "ccdred", adapter: "generic", kind: "image", output: null,
  parameters: [maxCache],
  inputs: [{ name: "images", label: "images", kind: "image", multiple: true }],
  outputs: [{ name: "output", kind: "image", default: "p_" }],
}
const catalog: Catalog = { version: "test", tasks: [spec], ccdproc: { parameters: [], inputs: [] }, ccdred: [], exam: {} }
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }

function store() {
  const s = createDiagnosticStore()
  s.replaceCurrent("doc", [
    { id: "1", severity: "error", message: images, nodeId: "n", field: "images" },
    { id: "2", severity: "warning", message: cache, nodeId: "n", field: "max_cache" },
    { id: "3", severity: "error", message: "노드 전체의 문제", nodeId: "n" },
    { id: "4", severity: "error", message: "다른 노드", nodeId: "m", field: "images" },
  ])
  return s
}

test("a node's problems by the field they name, the worst severity and every message", () => {
  const s = store()
  const issues = s.fieldIssues("n")
  expect([...issues]).toEqual([
    ["images", { severity: "error", message: images }],
    ["max_cache", { severity: "warning", message: cache }],
  ])
  s.replaceCurrent("doc", [
    { id: "1", severity: "warning", message: "images: 짝", nodeId: "n", field: "images" },
    { id: "2", severity: "error", message: images, nodeId: "n", field: "images" },
  ])
  expect(fieldIssues(s.getSnapshot(), "n").get("images")).toEqual({ severity: "error", message: `${images}\nimages: 짝` })
  // Recorded run problems are not the editor's current ones.
  expect(fieldIssues([{ id: "x", severity: "error", message: "m", source: "s", timestamp: 0, nodeId: "n", field: "images" }], "n").size).toBe(0)
})

test("the same problems are marked on the inspector field, the node row and the command token", () => {
  const issues = store().fieldIssues("n")
  // Inspector: the input's button and the parameter's control, aria-invalid in their severity.
  const task = makeInstance(spec, catalog, prefs, "n")
  task.expressions.images = "@input.list"
  task.draft.parameters.max_cache = "-1"
  const input = renderToStaticMarkup(
    <InspectorFileSource s={spec.inputs[0]} prefix="" compact={false} limit={0} setExpanded={() => {}} summary="@input.list"
      expression="@input.list" links={[]} pick={() => {}} ids={[]} replace={() => {}} rows={[]} onOpen={() => {}}
      onInputSource={undefined} map={emptyMap()} task={task} issue={issues.get("images")} />)
  expect(input).toMatch(/<button[^>]*aria-label="images 입력 변경"[^>]*aria-invalid="true"[^>]*data-severity="error"/)
  const setting = renderToStaticMarkup(
    <ParameterTable parameters={[maxCache]} values={{ max_cache: "-1" }} change={() => {}} scope="editor-task" keyPrefix="" issues={issues} />)
  expect(setting).toMatch(/<input[^>]*id="editor-task-max_cache"[^>]*aria-invalid="true"[^>]*data-severity="warning"/)
  // Without a problem, nothing is marked.
  expect(renderToStaticMarkup(<ParameterTable parameters={[maxCache]} values={{}} change={() => {}} scope="s" />)).not.toContain(`aria-invalid="`)

  // Node: the images row and the pinned max_cache row in their severity.
  const map = addTask(emptyMap(), { ...task, pinned: ["max_cache"] })
  const [node] = flowNodes(map, catalog) as TaskFlowNode[]
  const context = {
    map, catalog, rows: [], currentIssues: store().getSnapshot(), choose: () => {}, duplicate: () => {}, setCollapsed: () => {},
    setGroupCollapsed: () => {}, editGroup: () => {}, hiddenNodes: new Set<string>(), valueLabel: () => "", edges: [],
    selectingGroup: false, dragPreview: {}, validateConnection: () => ({ valid: true }),
  } as unknown as React.ContextType<typeof WorkflowContext>
  const html = renderToStaticMarkup(
    <ReactFlowProvider>
      <WorkflowContext.Provider value={context}>
        <TaskNode id="n" data={node.data} selected={false} dragging={false} isConnectable type="task" zIndex={0}
          selectable draggable deletable positionAbsoluteX={0} positionAbsoluteY={0} />
      </WorkflowContext.Provider>
    </ReactFlowProvider>)
  expect(html).toMatch(/class="node-input-row"[^>]*data-severity="error"[^>]*>(?:(?!node-input-row).)*data-input-role="images"/)
  expect(html).toMatch(/class="node-input-row node-param-row"[^>]*data-severity="warning"[^>]*>(?:(?!node-input-row).)*max_cache/)
  expect(html.match(/data-severity="(error|warning)"/g)?.length).toBe(3)

  // 명령: each field's problem on the token that sets it.
  const text = "ccdproc @input.list max_cache=-1"
  const tokens = [{ name: "images", start: 8, end: 19 }, { name: "max_cache", start: 30, end: 32 }]
  expect(tokenIssues(tokens, issues).map((i) => [text.slice(i.start, i.end), i.severity, i.message])).toEqual([
    ["@input.list", "error", images], ["-1", "warning", cache],
  ])
  const line = renderToStaticMarkup(<CommandList groups={[{ id: "", name: "", files: [], lines: [{ text, tokens }] }]} catalog={catalog} task={task} issues={issues} />)
  expect(line).toMatch(/<mark class="command-issue" data-severity="error"[^>]*>@input.list<\/mark>/)
  expect(line).toMatch(/<mark class="command-issue" data-severity="warning"[^>]*>-1<\/mark>/)
})
