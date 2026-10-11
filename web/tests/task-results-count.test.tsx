import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { TaskResults } from "../src/components/task-results"
import { emptyMap, type Instance, type MapRun, type TaskMap } from "../src/lib/task-map"
import { makeDraft, type Spec } from "../src/lib/workbench"

const spec = {
  name: "imcombine", title: "", package: "immatch", parameters: [], kind: "image",
  inputs: [{ name: "input", label: "", multiple: true, kind: "image" }],
  output: { name: "output", mode: "single", default: "M67" },
} as unknown as Spec
const task = { id: "combine", task: "imcombine", label: "imcombine", draft: makeDraft(spec, undefined) } as unknown as Instance
const run = (group: string): MapRun => ({
  id: group, instanceId: "combine", state: "completed", workflow: "w1", group,
  products: [
    { id: `M67${group}.fits`, label: `M67${group}.fits` },
    { id: `log-${group}`, label: "imcombine-results.txt", asset: "text", role: "$log" },
  ],
} as MapRun)

test("the results heading counts what the node's output counts, not logs", () => {
  const map: TaskMap = { ...emptyMap(), tasks: [task], runs: [run("B"), run("V")] }
  const html = renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <TaskResults map={map} task={task} spec={spec} />
    </QueryClientProvider>
  )
  expect(html).toContain('aria-label="결과 2개"')
  expect(html).toContain("imcombine-results.txt")
})
