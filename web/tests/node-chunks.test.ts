import { expect, test } from "bun:test"
import { isModeOnly, nodeTiles } from "../src/lib/node-chunks"
import { taskPackageTree, taskRowText } from "../src/lib/task-tree"
import type { Spec } from "../src/lib/workbench"

const node = (name: string, run?: string) =>
  ({ name, title: name, package: "giraf", run }) as Spec

test("GIRAF nodes are one row of tiles in a fixed order by run; 값 is one tile", () => {
  // Catalog order, as the server sends it.
  const nodes = [
    node("compute", "value-compute"),
    node("files", "pass-files"),
    node("save", "save-files"),
    node("header", "value-header"),
    node("value", "value-constant"),
    node("pset", "pset"),
  ]
  expect(nodeTiles(nodes).map((n) => n.name)).toEqual(["files", "save", "value"])
  // The other 가져오기 runs are reached from the 값 node; search still finds them.
  expect(nodes.filter(isModeOnly).map((n) => n.name)).toEqual(["compute", "header", "pset"])
})

test("a node the order does not name follows the known ones in catalog order", () => {
  const tiles = nodeTiles([node("later", "something-new"), node("header", "value-header"), node("value", "value-constant"), node("bare")])
  expect(tiles.map((n) => n.name)).toEqual(["value", "later", "bare"])
})

test("the package tree leaves out superseded packages", () => {
  const tasks = [
    { name: "obsolete.radplt", package: "obsolete" },
    { name: "obsolete.sub.x", package: "obsolete.sub" },
    { name: "images.imcopy", package: "images" },
  ] as Spec[]
  expect(taskPackageTree(tasks).map((n) => n.label)).toEqual(["images"])
})

test("a task row names the task and its package, and says what it does only when that is not the name again", () => {
  const daofind = (pkg: string, description?: string) =>
    ({ name: `${pkg}.daofind`, taskName: "daofind", title: "daofind", package: pkg, description }) as Spec
  expect(taskRowText(daofind("noao.digiphot.apphot", "Find stars in an image"))).toEqual(
    { name: "daofind", package: "noao.digiphot.apphot", description: "Find stars in an image" })
  // No description: nothing under the name, not the name twice.
  expect(taskRowText(daofind("noao.digiphot.daophot"))).toEqual({ name: "daofind", package: "noao.digiphot.daophot" })
  expect(taskRowText({ name: "zerocombine", title: "zerocombine", package: "noao.imred.ccdred", description: "ZeroCombine" } as Spec))
    .toEqual({ name: "zerocombine", package: "noao.imred.ccdred" })
  // A GIRAF node is named by its title and has no package to show.
  expect(taskRowText({ name: "giraf.file_input", taskName: "파일 입력", title: "파일 입력", package: "giraf", description: "고른 파일을 넘김" } as Spec))
    .toEqual({ name: "파일 입력", description: "고른 파일을 넘김" })
})
