import { expect, test } from "bun:test"
import { nodeChunks } from "../src/lib/node-chunks"
import { taskPackageTree } from "../src/lib/task-tree"
import type { Spec } from "../src/lib/workbench"

const node = (name: string, run?: string) =>
  ({ name, title: name, package: "giraf", run }) as Spec

test("GIRAF nodes split into files, flow and values by run, in a fixed order", () => {
  // Catalog order, as the server sends it.
  const nodes = [
    node("compute", "value-compute"),
    node("files", "pass-files"),
    node("save", "save-files"),
    node("for", "for"),
    node("foreach", "foreach"),
    node("header", "value-header"),
    node("if", "if"),
    node("value", "value-constant"),
  ]
  expect(nodeChunks(nodes).map((c) => [c.id, c.label, c.nodes.map((n) => n.name)])).toEqual([
    ["files", "파일", ["files", "save"]],
    ["flow", "흐름", ["foreach", "for", "if"]],
    ["values", "값", ["value", "header", "compute"]],
  ])
})

test("a node no chunk names joins the values chunk, and empty chunks drop", () => {
  const chunks = nodeChunks([node("later", "something-new"), node("value", "value-constant"), node("bare")])
  expect(chunks.map((c) => [c.id, c.nodes.map((n) => n.name)])).toEqual([
    ["values", ["value", "later", "bare"]],
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
