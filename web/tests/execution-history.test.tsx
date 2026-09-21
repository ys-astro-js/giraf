import { expect, test } from "bun:test"
import { groupExecutions } from "../src/lib/execution-history"
import type { Job } from "../src/lib/workbench"
const job = (id: string, workflowId?: string) =>
  ({
    id,
    name: "imcopy",
    state: "completed",
    products: [],
    manifest: workflowId ? { workflowId } : undefined,
  }) as Job

test("one click groups its jobs in execution order and repeated clicks stay separate", () => {
  const groups = groupExecutions([
    job("20260921-120003-c", "second"),
    job("20260921-120002-b", "first"),
    job("20260921-120001-a", "first"),
    job("20260921-110000-single"),
  ])
  expect(groups.map((g) => g.jobs.map((j) => j.id))).toEqual([
    ["20260921-120003-c"],
    ["20260921-120001-a", "20260921-120002-b"],
    ["20260921-110000-single"],
  ])
  expect(groups[1].workflow).toBe(true)
  expect(groups[2].workflow).toBe(false)
  const early = {
    ...job("20260921-120000-z", "same"),
    manifest: { workflowId: "same", workflowStep: 0 },
  } as Job
  const late = {
    ...job("20260921-120000-a", "same"),
    manifest: { workflowId: "same", workflowStep: 1 },
  } as Job
  expect(groupExecutions([late, early])[0].jobs.map((j) => j.id)).toEqual([
    early.id,
    late.id,
  ])
})
test("legacy current workflow membership groups jobs without guessing from their timestamps", () => {
  const jobs = [job("b"), job("a"), job("other")]
  expect(
    groupExecutions(jobs, {
      id: "legacy",
      jobs: [jobs[1]],
      currentJob: jobs[0],
    }).map((g) => g.jobs.map((j) => j.id))
  ).toEqual([["other"], ["a", "b"]])
  expect(groupExecutions([])).toEqual([])
})
test("failed jobs without outputs remain in history", () => {
  expect(
    groupExecutions([{ ...job("a", "run"), state: "failed" }])[0].jobs[0].state
  ).toBe("failed")
})

test("persisted execution memberships remain grouped when another workflow becomes current", () => {
  const saved = [
    { ...job("b"), execution: { id: "old", step: 1 } },
    { ...job("a"), execution: { id: "old", step: 0 } },
  ]
  expect(
    groupExecutions(saved, {
      id: "new",
      jobs: [],
      currentJob: null,
    })[0].jobs.map((j) => j.id)
  ).toEqual(["a", "b"])
  expect(groupExecutions(saved)[0].id).toBe("workflow:old")
})
