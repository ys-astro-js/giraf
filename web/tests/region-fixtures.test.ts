import { expect, test } from "bun:test"
import { migrateMap, type TaskMap } from "../src/lib/task-map"
import { normalizeFileInputs } from "../src/lib/file-nodes"
import { splitIssues } from "../src/lib/splits"
import type { Catalog, Preferences } from "../src/lib/workbench"
import preprocessing from "./fixtures/regions/Preprocessing2.json"
import photometry from "./fixtures/regions/Photometry2.json"
import catalogJson from "./fixtures/regions/catalog.json"

// The user's documents before regions were removed (M67, 2026-10-11), opened as the editor opens a document.
// The catalog still lists the region node, as a stale one did on the first open.
const catalog = catalogJson as unknown as Catalog
const open = (doc: unknown): TaskMap => {
  const { taskMap, preferences } = structuredClone(doc) as { taskMap: TaskMap; preferences: Partial<Preferences> }
  return normalizeFileInputs(migrateMap({ drafts: {}, backend: "cl", mapping: {}, instrument: [], packageValues: {}, ...preferences, taskMap }, catalog), catalog, [])
}
const byLabel = (map: TaskMap, label: string) => map.tasks.filter((t) => t.label === label)
const one = (map: TaskMap, label: string) => {
  const [t] = byLabel(map, label)
  expect(t).toBeDefined()
  return t
}

test("Preprocessing2: every region becomes splits and pairing", () => {
  const map = open(preprocessing)
  expect(map.tasks.some((t) => t.task === "giraf.foreach")).toBe(false)
  expect(map.tasks.filter((t) => t.migrated).map((t) => t.label)).toEqual([])
  expect(one(map, "Bias 묶음").draft.split).toEqual({ input: "input", by: [{ per: 5 }] })
  expect(one(map, "Dark 묶음").draft.split).toEqual({ input: "input", by: [{ key: "EXPTIME" }, { per: 5 }] })
  const master = one(map, "Master Dark")
  expect(master.draft.split).toEqual({ input: "input", by: [{ key: "EXPTIME" }] })
  // Zero is one file: it goes to every group without a rule.
  expect(master.draft.pairing ?? {}).toEqual({})
  const ccd = one(map, "ccdproc")
  expect(ccd.draft.split).toEqual({ input: "images", by: [{ key: "SUBSET" }, { key: "EXPTIME" }] })
  expect(ccd.draft.pairing).toEqual({ dark: { by: "EXPTIME" }, flat: { by: "SUBSET" } })
  expect(one(map, "M67").draft.split).toEqual({ input: "input", by: [{ key: "SUBSET" }] })
  expect(splitIssues(map)).toEqual([])
  // Regions are gone; the plain group around them stays.
  expect(map.subflows?.map((g) => g.name)).toEqual(["Bias", "Dark", "Flat", "Process", "Combine"])
  expect(one(map, "ccdproc").subflowId).toBe(map.subflows![3].id)
  expect(map.tasks.every((t) => !t.subflowId || map.subflows!.some((g) => g.id === t.subflowId))).toBe(true)
})

test("Photometry2: a selection, splits along the PSF chain, and values per group", () => {
  const before = open({ ...(photometry as object), taskMap: { ...(photometry as { taskMap: TaskMap }).taskMap } })
  const map = before
  expect(map.tasks.some((t) => t.task === "giraf.foreach")).toBe(false)
  expect(map.tasks.filter((t) => t.migrated).map((t) => t.label)).toEqual([])
  const daofind = one(map, "daofind")
  expect(daofind.draft.split).toBeUndefined()
  expect(daofind.draft.select).toEqual({ image: { key: "SUBSET", values: ["B"] } })
  const phot = one(map, "phot")
  expect(phot.draft.split).toEqual({ input: "image", by: [{ key: "SUBSET" }] })
  // daofind's one coo file goes to every group.
  expect(phot.draft.pairing ?? {}).toEqual({})
  expect(one(map, "txdump").draft.split).toEqual({ input: "textfiles", by: [{ each: true }] })
  expect(one(map, "txdump").draft.outputs?.["$stdout"]).toBe("M67.dat")
  const psf1 = one(map, "psf 1")
  expect(psf1.draft.split).toEqual({ input: "image", by: [{ key: "SUBSET" }] })
  expect(psf1.draft.pairing).toEqual({ photfile: { order: true } })
  expect(one(map, "allstar").draft.split).toEqual({ input: "image", by: [{ key: "SUBSET" }] })
  expect(one(map, "allstar").draft.pairing).toEqual({ photfile: { order: true }, psfimage: { order: true } })
  expect(one(map, "substar").draft.split).toEqual({ input: "image", by: [{ key: "SUBSET" }] })
  expect(one(map, "substar").draft.pairing).toEqual({ photfile: { order: true }, exfile: { order: true }, psfimage: { order: true } })
  const psf2 = one(map, "psf 2")
  expect(psf2.draft.split).toEqual({ input: "image", by: [{ each: true }] })
  expect(psf2.draft.pairing).toEqual({ photfile: { order: true }, pstfile: { order: true } })
  expect(one(map, "seepsf").draft.split).toEqual({ input: "psfimage", by: [{ each: true }] })
  // The per-filter table of the value node is its values per group.
  const values = one(map, "측정값")
  expect(values.draft.groupValues).toEqual({ fwhm: { B: "8.8", V: "8.7" }, sigma: { B: "24", V: "25" }, sky: { B: "1200", V: "860" } })
  expect(values.draft.valueRows?.every((r) => !("groups" in r))).toBe(true)
  expect("partition" in values.draft).toBe(false)
})

test("migration adds no connection or file input of its own", () => {
  for (const doc of [preprocessing, photometry]) {
    const { taskMap } = structuredClone(doc) as { taskMap: TaskMap }
    const map = open(doc)
    const files = (m: TaskMap) => m.tasks.filter((t) => t.task === "giraf.file_input").map((t) => [t.id, t.draft.inputs.files ?? []])
    expect(files(map)).toEqual(files(taskMap))
    const regions = new Set(taskMap.tasks.filter((t) => t.task === "giraf.foreach").map((t) => t.id))
    const kept = taskMap.connections.filter((c) => !regions.has(c.target) && !(c.source.kind !== "files" && regions.has(c.source.taskId ?? "")))
    expect(map.connections.map((c) => c.id).sort()).toEqual(kept.map((c) => c.id).sort())
  }
})
