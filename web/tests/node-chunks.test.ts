import { expect, test } from "bun:test"
import { isModeOnly, nodeChunks } from "../src/lib/node-chunks"
import { taskPackageTree } from "../src/lib/task-tree"
import type { Spec } from "../src/lib/workbench"

const node = (name: string, run?: string) =>
  ({ name, title: name, package: "giraf", run }) as Spec

test("GIRAF nodes split into files and script by run, in a fixed order; 값 is one tile", () => {
  // Catalog order, as the server sends it.
  const nodes = [
    node("compute", "value-compute"),
    node("files", "pass-files"),
    node("save", "save-files"),
    node("header", "value-header"),
    node("value", "value-constant"),
    node("pset", "pset"),
  ]
  expect(nodeChunks(nodes).map((c) => [c.id, c.label, c.nodes.map((n) => n.name)])).toEqual([
    ["files", "파일", ["files", "save"]],
    ["script", "스크립트하기", ["value"]],
  ])
  // The other 가져오기 runs are reached from the 값 node; search still finds them.
  expect(nodes.filter(isModeOnly).map((n) => n.name)).toEqual(["compute", "header", "pset"])
})

test("a node no chunk names joins the script chunk after the known ones, and empty chunks drop", () => {
  const chunks = nodeChunks([node("later", "something-new"), node("header", "value-header"), node("value", "value-constant"), node("bare")])
  expect(chunks.map((c) => [c.id, c.nodes.map((n) => n.name)])).toEqual([
    ["script", ["value", "later", "bare"]],
  ])
})

test("the package tree leaves out superseded packages", () => {
  const tasks = [
    { name: "obsolete.radplt", package: "obsolete" },
    { name: "obsolete.sub.x", package: "obsolete.sub" },
    { name: "images.imcopy", package: "images" },
  ] as Spec[]
  expect(taskPackageTree(tasks).map((n) => n.label)).toEqual(["images"])
})
