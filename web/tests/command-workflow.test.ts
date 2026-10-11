import { beforeAll, expect, test } from "bun:test"
import parsed from "./fixtures/commands/m67-bias-dark.json"
import catalogJson from "./fixtures/regions/catalog.json"
import { buildCommandNodes, commandRuns, inferSplit, placeCommandNodes, type ParsedCommands } from "../src/lib/command-workflow"
import { emptyMap, type Instance } from "../src/lib/task-map"
import { splitGroups } from "../src/lib/splits"
import type { Catalog, Frame, Preferences } from "../src/lib/workbench"

// Bun exposes `self` in its main thread; ELK otherwise mistakes it for a worker (as in workflow-layout.test.ts).
beforeAll(async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self")
  Reflect.deleteProperty(globalThis, "self")
  try { const { default: ELK } = await import("elkjs/lib/elk.bundled.js"); new ELK() }
  finally { if (descriptor) Object.defineProperty(globalThis, "self", descriptor) }
})

// The course's bias and dark steps as the server reads them (tests/test_command_parse.py keeps this in step).
const commands = parsed as ParsedCommands
const catalog = catalogJson as unknown as Catalog
const prefs: Preferences = { drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {} }
const exposures = ["bias", "dark15", "dark30", "dark60", "dark90"]
// The M67 folder: real names, and the EXPTIME the inventory reads from each header.
const rows: Frame[] = exposures.flatMap((kind) => Array.from({ length: 10 }, (_, i) => {
  const label = `AutosaveImage-${String(i + 1).padStart(4, "0")}${kind}.fits`
  return { id: "f:" + label, label, asset: "image", headers: { EXPTIME: kind === "bias" ? "0" : kind.slice(4), IMAGETYP: kind === "bias" ? "Bias Frame" : "Dark Frame" } }
}))
const lineOf = (text: string) => commands.lines.find((l) => l.text.startsWith(text))!
const labelOf = (map: { tasks: Instance[] }, id: string) => map.tasks.find((t) => t.id === id)!.label
const fileNode = (map: ReturnType<typeof buildCommandNodes>["map"], taskId: string, role: string) => {
  const link = map.connections.find((c) => c.target === taskId && c.role === role && c.source.kind === "pending" &&
    map.tasks.find((t) => t.id === (c.source as { taskId: string }).taskId)?.task === "giraf.file_input")!
  const node = (link.source as { taskId: string }).taskId
  return map.connections.find((c) => c.target === node && c.source.kind === "files")!.source as { ids: string[] }
}

test("each line is a node, set as the inspector sets it, and connected by file name", () => {
  const built = buildCommandNodes(emptyMap(), catalog, prefs, rows, commands)
  const tasks = built.added.map((id) => built.map.tasks.find((t) => t.id === id)!)
  expect(tasks.map((t) => t.task)).toEqual([...Array(3).fill("zerocombine"), ...Array(12).fill("darkcombine")])
  const [zero1, , zero] = tasks
  expect(zero1.draft.output.name).toBe("Zero1")
  expect(zero1.draft.parameters).toMatchObject({ combine: "median", reject: "none", ccdtype: "", scale: "none", rdnoise: "15", gain: "1.4" })
  // The folder's bias files reach zerocomb through a file node holding exactly them.
  expect(fileNode(built.map, zero1.id, "input").ids).toEqual(lineOf("zerocomb @Bias1").inputs!.input.items.map((i) => "f:" + i.file))
  // Zero1,Zero2 are the first two lines' outputs.
  const into = (id: string, role: string) => built.map.connections.filter((c) => c.target === id && c.role === role && c.source.kind === "pending")
    .map((c) => labelOf(built.map, (c.source as { taskId: string }).taskId))
  expect(into(zero.id, "input")).toEqual(["zerocombine", "zerocombine 2"])
  // ccdproc.* assignment lines set the ccdproc darkcombine runs first; ccdproc.zero="Zero.fits" is the master bias.
  const dark = tasks[3]
  expect(dark.preprocess.parameters).toMatchObject({ zerocor: "yes", darkcor: "no", flatcor: "no", trim: "no", fixpix: "no", overscan: "no" })
  expect(into(dark.id, "zero")).toEqual(["zerocombine 3"])
  expect(into(tasks[11].id, "input")).toEqual(["darkcombine", "darkcombine 2"])
  // The masters combine with process=no: ccdproc's zero is not run there, so nothing connects to it.
  expect(into(tasks[11].id, "zero")).toEqual([])
  expect(built.inactive[lineOf("darkc Dark15-1,").index]).toEqual(["zero"])
  expect(built.issues).toEqual({})
})

test("one line naming no folder file and no earlier output is still a node, its input kept as written", () => {
  const line = { index: 0, line: 1, text: "zerocombine AutosaveImage-0001bias.fits output=Zero", kind: "task" as const,
    issues: ["AutosaveImage-0001bias.fits: 폴더의 파일이나 앞 줄의 출력이 아닙니다."], task: "zerocombine", taskName: "zerocombine",
    inputs: { input: { text: "AutosaveImage-0001bias.fits", items: [{ name: "AutosaveImage-0001bias.fits", missing: true as const }] } },
    outputs: { output: { text: "Zero", value: "Zero", labels: ["Zero.fits"] } } }
  const built = buildCommandNodes(emptyMap(), catalog, prefs, [], { lines: [line] })
  expect(built.added.length).toBe(1)
  const [task] = built.map.tasks
  expect([task.draft.output.name, task.expressions?.input]).toEqual(["Zero", "AutosaveImage-0001bias.fits"])
})

test("a run of lines that differ only in files is offered as one node, with the split that makes their lists", () => {
  const runs = commandRuns(commands, rows)
  expect(runs.map((r) => [r.lines.map((i) => commands.lines[i].text.split(" ")[1]), r.input, r.output, r.split?.by, r.root])).toEqual([
    [["@Bias1.list", "@Bias2.list"], "input", "output", [{ per: 5 }], "Zero"],
    [["@Dark15-1.list", "@Dark15-2.list", "@Dark30-1.list", "@Dark30-2.list", "@Dark60-1.list", "@Dark60-2.list", "@Dark90-1.list", "@Dark90-2.list"],
      "input", "output", [{ key: "EXPTIME" }, { per: 5 }], "Dark"],
    // Unmerged, the darks' outputs carry no headers yet: chunks of two in name order.
    [["Dark15-1,Dark15-2", "Dark30-1,Dark30-2", "Dark60-1,Dark60-2", "Dark90-1,Dark90-2"], "input", "output", [{ per: 2 }], "Dark"],
  ])
  // Merged, each dark group's output carries the EXPTIME it was made by, so the next run splits by it and keeps its names.
  const darks = runs[1].lines[0]
  const after = commandRuns(commands, rows, new Set([darks]))[2]
  expect([after.split?.by, after.root]).toEqual([[{ key: "EXPTIME" }], "Dark"])
})

test("merging makes one node whose groups make the lines' own output names", () => {
  const runs = commandRuns(commands, rows)
  const merged = new Set([runs[1].lines[0], runs[2].lines[0]])
  const built = buildCommandNodes(emptyMap(), catalog, prefs, rows, commands, merged)
  const tasks = built.added.map((id) => built.map.tasks.find((t) => t.id === id)!)
  expect(tasks.map((t) => t.task)).toEqual(["zerocombine", "zerocombine", "zerocombine", "darkcombine", "darkcombine"])
  const [, , , darks, masters] = tasks
  expect(darks.draft.split).toEqual({ input: "input", by: [{ key: "EXPTIME" }, { per: 5 }] })
  expect(darks.draft.output.name).toBe("Dark")
  const files = fileNode(built.map, darks.id, "input").ids
  expect(files.length).toBe(40)
  const frames = new Map(rows.map((r) => [r.id, r]))
  expect(splitGroups(files, darks.draft.split!.by, frames)!.map((g) => "Dark" + g.suffix))
    .toEqual(["Dark15-1", "Dark15-2", "Dark30-1", "Dark30-2", "Dark60-1", "Dark60-2", "Dark90-1", "Dark90-2"])
  expect(masters.draft.split).toEqual({ input: "input", by: [{ key: "EXPTIME" }] })
  expect(built.map.connections.filter((c) => c.target === masters.id && c.role === "input").map((c) => c.source))
    .toEqual([{ kind: "pending", taskId: darks.id }])
  expect(built.issues).toEqual({})
})

test("a reused file node, a disabled merge and a partial read are what they are", () => {
  // The same bias files already in a file node on the canvas are that node.
  const first = buildCommandNodes(emptyMap(), catalog, prefs, rows, commands)
  const again = buildCommandNodes(first.map, catalog, prefs, rows, commands)
  const fileNodes = again.map.tasks.filter((t) => t.task === "giraf.file_input")
  expect(fileNodes.length).toBe(first.map.tasks.filter((t) => t.task === "giraf.file_input").length)
  // No split makes lists of overlapping files.
  expect(inferSplit([["a", "b"], ["b", "c"]], new Map())).toBeUndefined()
  // Merged darks read by one unmerged master: only two of eight outputs.
  const runs = commandRuns(commands, rows)
  const built = buildCommandNodes(emptyMap(), catalog, prefs, rows, commands, new Set([runs[1].lines[0]]))
  expect(Object.values(built.issues).flat()[0]).toBe("input: 합친 노드의 결과 중 일부만 받습니다.")
})

test("new nodes are laid out left to right below the nodes already there", async () => {
  const first = buildCommandNodes(emptyMap(), catalog, prefs, rows, commands)
  const placed = await placeCommandNodes(emptyMap(), first.map, catalog, rows)
  const position = (id: string) => placed.tasks.find((t) => t.id === id)!.position!
  const [zero1, , zero] = first.added
  expect(position(zero).x).toBeGreaterThan(position(zero1).x)
  const second = buildCommandNodes(placed, catalog, prefs, rows, commands)
  const below = await placeCommandNodes(placed, second.map, catalog, rows)
  const lowest = Math.max(...placed.tasks.map((t) => t.position!.y))
  expect(second.added.every((id) => below.tasks.find((t) => t.id === id)!.position!.y > lowest)).toBe(true)
})
