import { expect, test } from "bun:test"
import { groupDraft, splitGroups } from "../src/lib/splits"
import { emptyMap, latestRuns, runState, type MapRun, type TaskMap } from "../src/lib/task-map"
import { makeDraft, plannedOutputs, type Frame, type Spec } from "../src/lib/workbench"

const run = (id: string, state: string, group?: string, workflow = "w1"): MapRun =>
  ({ id, instanceId: "combine", state, workflow, ...(group ? { group } : {}), products: [{ id: `${id}.fits`, label: `${id}.fits` }] })
const withRuns = (runs: MapRun[]): TaskMap => ({ ...emptyMap(), runs })

test("a split task's results are every group's newest run of its last workflow run", () => {
  const map = withRuns([run("old-B", "completed", "B", "w0"), run("B", "completed", "B"), run("V", "completed", "V")])
  expect(latestRuns(map, "combine").map((r) => r.id)).toEqual(["B", "V"])
  expect(runState(map, "combine")).toBe("completed")
})

test("a split task runs while any group runs and failed when any group failed", () => {
  expect(runState(withRuns([run("B", "running", "B"), run("V", "queued", "V")]), "combine")).toBe("running")
  expect(runState(withRuns([run("B", "failed", "B"), run("V", "completed", "V")]), "combine")).toBe("failed")
  expect(runState(withRuns([run("one", "cancelled")]), "combine")).toBe("cancelled")
  expect(runState(withRuns([]), "combine")).toBeUndefined()
})

test("planned output names follow each group's draft", () => {
  const spec: Spec = {
    name: "imcombine", title: "", package: "immatch", parameters: [], kind: "image",
    inputs: [{ name: "input", label: "", multiple: true, kind: "image" }],
    output: { name: "output", mode: "single", default: "M67" },
  } as Spec
  const frames: Frame[] = ["b1", "b2", "v1"].map((id) => ({ id, label: `${id}.fits`, headers: { SUBSET: id[0].toUpperCase() } }))
  const groups = splitGroups(frames.map((f) => f.id), [{ key: "SUBSET" }], new Map(frames.map((f) => [f.id, f])))!
  const draft = { ...makeDraft(spec, undefined), inputs: { input: frames.map((f) => f.id) } }
  const planned = groups.flatMap((g) => plannedOutputs(spec, groupDraft(spec, draft, "input", g, groups.length), frames))
  expect(planned.map((p) => p.output)).toEqual(["M67B.fits", "M67V.fits"])
  expect(groupDraft(spec, draft, "input", groups[1], groups.length).inputs.input).toEqual(["v1"])
})
