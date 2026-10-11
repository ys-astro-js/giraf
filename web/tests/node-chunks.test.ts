import { expect, test } from "bun:test"
import { isModeOnly, nodeTiles } from "../src/lib/node-chunks"
import { taskPackageTree } from "../src/lib/task-tree"
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
