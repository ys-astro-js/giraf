import { expect, test } from "bun:test"
import { emptyMap, ownsRun } from "../src/lib/task-map"
import { makeDraft, type Job, type Manifest } from "../src/lib/workbench"

const task = (id: string, name: string) => ({
  id,
  task: name,
  label: id,
  draft: makeDraft(),
  preprocess: makeDraft(),
  mapping: {},
  instrument: [],
  packageValues: {},
  backend: "cl",
  expressions: {},
  filePolicy: { mode: "copy" as const, backup: true },
})
const run = (instanceId: string, name: string): Pick<Job, "manifest"> => ({
  manifest: { instanceId, task: name } as Manifest & { instanceId: string },
})

test("a run lands only in the document whose task it ran", () => {
  const photometry = emptyMap()
  photometry.tasks = [task("phot", "phot"), task("combine", "images.immatch.imcombine")]
  // Preprocessing's run, still followed after Photometry opened.
  expect(ownsRun(photometry, "pdf-finalB", run("pdf-finalB", "ccdproc"))).toBe(false)
  // The same node id in another document running another task is not this one either.
  expect(ownsRun(photometry, "combine", run("combine", "ccdproc"))).toBe(false)
  expect(ownsRun(photometry, "combine", run("combine", "images.immatch.imcombine"))).toBe(true)
  expect(ownsRun(photometry, "phot", {})).toBe(true)
})
