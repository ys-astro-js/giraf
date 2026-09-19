// Behavior contracts written before the sidebar implementation.
import { expect, test } from "bun:test"
import {
  partitionFiles,
  filterFiles,
  defaultFileFilters,
  exposureError,
  hiddenSelectionCount,
  toggleFileSelection,
  runLabel,
} from "../src/lib/file-library"
import type { Frame } from "../src/lib/workbench"

const rows: Frame[] = [
  {
    id: "folder",
    label: "Zero0.fits",
    path: "/data/Zero0.fits",
    group: "results",
    detected_kind: "bias",
    filter: "B",
    exposure: 0,
    history: { NCOMBINE: "10" },
  },
  {
    id: "r1",
    label: "Zero0.fits",
    job: "20260916-120000-abc",
    detected_kind: "bias",
    filter: "B",
    exposure: 0,
  },
  {
    id: "r2",
    label: "Zero0.fits",
    job: "20260916-130000-def",
    detected_kind: "flat",
    filter: "V",
    exposure: 30,
  },
  {
    id: "science",
    label: "관측🌙.fits",
    detected_kind: "science",
    filter: "V",
    exposure: 60,
  },
  {
    id: "log",
    label: "zerocombine-results.txt",
    job: "20260916-120000-abc",
    asset: "text",
  },
]
test("provenance follows run ownership, not inferred image type or duplicate filename", () => {
  const groups = partitionFiles(rows)
  expect(groups.folder.map((r) => r.id)).toEqual(["folder", "science"])
  expect(groups.runs.map((r) => r.id)).toEqual([
    "20260916-130000-def",
    "20260916-120000-abc",
  ])
  expect(groups.runs[1].files.map((r) => r.id)).toEqual(["r1", "log"])
  expect(rows).toHaveLength(5)
})
test("opening a run directory never duplicates one file or loses its local provenance", () => {
  for (const files of [
    [rows[1], { ...rows[1], job: undefined }],
    [{ ...rows[1], job: undefined }, rows[1]],
  ]) {
    const groups = partitionFiles(files)
    expect(groups.folder.map((r) => r.id)).toEqual(["r1"])
    expect(groups.runs).toHaveLength(0)
  }
})
test("search and metadata filters combine, preserve zero exposure, and tolerate missing metadata", () => {
  expect(
    filterFiles(rows, " ZERO0 ", {
      ...defaultFileFilters,
      kind: "bias",
      band: "B",
      maxExposure: "0",
    }).map((r) => r.id)
  ).toEqual(["folder", "r1"])
  expect(
    filterFiles(rows, "관측🌙", defaultFileFilters).map((r) => r.id)
  ).toEqual(["science"])
  expect(
    filterFiles(rows, "", {
      ...defaultFileFilters,
      minExposure: "30",
      maxExposure: "60",
    }).map((r) => r.id)
  ).toEqual(["r2", "science"])
  expect(filterFiles(rows, "", defaultFileFilters)).toHaveLength(5)
  expect(filterFiles(rows, "no-match", defaultFileFilters)).toHaveLength(0)
})
test("invalid exposure bounds give an actionable error and cannot silently broaden results", () => {
  for (const bounds of [
    { minExposure: "60", maxExposure: "30" },
    { minExposure: "-1" },
    { maxExposure: "oops" },
    { minExposure: "Infinity" },
  ]) {
    const filters = { ...defaultFileFilters, ...bounds }
    expect(exposureError(filters)).not.toBe("")
    expect(filterFiles(rows, "", filters)).toEqual([])
  }
  expect(exposureError(defaultFileFilters)).toBe("")
  expect(
    exposureError({ ...defaultFileFilters, minExposure: "0", maxExposure: "0" })
  ).toBe("")
})
test("selection remains independent of filtering, collapsing and pagination, with deduplicated counts", () => {
  const selected = ["folder", "r1", "r2", "folder"]
  expect(hiddenSelectionCount(selected, new Set(["folder"]))).toBe(2)
  expect(hiddenSelectionCount(selected, new Set())).toBe(3)
  expect(toggleFileSelection(["folder", "r1"], "folder", true)).toEqual([
    "folder",
    "r1",
  ])
  expect(toggleFileSelection(selected, "folder", false)).toEqual(["r1", "r2"])
  expect(selected).toEqual(["folder", "r1", "r2", "folder"])
})
test("run headings show the timestamp without the identifier suffix", () => {
  expect(runLabel("20260916-130000-a1b2c3")).toBe("2026.09.16 13:00:00")
  expect(runLabel("imported-run")).toBe("imported-run")
})
