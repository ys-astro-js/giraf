import { expect, test } from "bun:test"
import { searchTasks } from "../src/lib/task-tree"
import type { Spec } from "../src/lib/workbench"

const task = (name: string, pkg: string, description = "") =>
  ({ name: `${pkg}.${name}`, taskName: name, package: pkg, title: name, description }) as Spec
const tasks = [
  task("ccdproc", "noao.imred.ccdred", "Combine-free CCD processing"),
  task("zerocombine", "noao.imred.ccdred", "Combine and process zero level images"),
  task("daofind", "noao.digiphot.apphot", "Find stars"),
  task("phot", "noao.digiphot.daofind", "Photometry"),
  task("combine", "noao.imred.ccdred", "Combine CCD images"),
  task("imcombine", "images.immatch", "Combine images pixel-by-pixel"),
  task("daofind", "noao.digiphot.daophot", "Find stars with daofind"),
  task("starfind", "images.imcoords", "Like daofind"),
]
const names = (query: string) => searchTasks(tasks, query).map((spec) => `${spec.package}.${spec.taskName}`)

test("a name match always comes before a package or description match", () => {
  expect(names("comb")).toEqual([
    "noao.imred.ccdred.combine",
    "noao.imred.ccdred.zerocombine",
    "images.immatch.imcombine",
    "noao.imred.ccdred.ccdproc",
  ])
})

test("both tasks named daofind come first, then the package match, then the description matches", () => {
  expect(names("DAOFIND")).toEqual([
    "noao.digiphot.apphot.daofind",
    "noao.digiphot.daophot.daofind",
    "noao.digiphot.daofind.phot",
    "images.imcoords.starfind",
  ])
})

test("an empty query finds nothing and a full catalog name finds its task", () => {
  expect(names("  ")).toEqual([])
  expect(names("immatch.imcombine")).toEqual(["images.immatch.imcombine"])
})
