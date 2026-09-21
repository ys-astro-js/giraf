// Behavior contracts defined before the punctuation and search refinement.
import { expect, test } from "bun:test"
import { defaultFileFilters, filterFiles } from "../src/lib/file-library"
import type { Frame } from "../src/lib/workbench"

test("file name search does not match filter, exposure, path or run metadata", () => {
  const files: Frame[] = [
    {
      id: "a",
      label: "Target.fits",
      path: "/metadata-only/Target.fits",
      filter: "V",
      exposure: 30,
      detected_kind: "science",
      job: "run-only",
    },
    { id: "b", label: "Ｖ_reference.fits", filter: "B", exposure: 0 },
  ]
  expect(
    filterFiles(files, " v_ ", defaultFileFilters).map((f) => f.id)
  ).toEqual(["b"])
  for (const query of ["30", "science", "metadata-only", "run-only"]) {
    expect(filterFiles(files, query, defaultFileFilters)).toEqual([])
  }
  expect(
    filterFiles(files, "target", {
      ...defaultFileFilters,
      band: "V",
      maxExposure: "30",
    }).map((f) => f.id)
  ).toEqual(["a"])
  expect(
    filterFiles(files, "target", { ...defaultFileFilters, band: "B" })
  ).toEqual([])
  expect(
    filterFiles(files, "target", defaultFileFilters).map((f) => f.id)
  ).toEqual(["a"])
})

test('task package trees retain qualified identity while display names omit package paths', async () => {
  const { taskDisplayName } = await import('../src/lib/workbench')
  const { taskPackageTree } = await import('../src/lib/task-tree')
  const tasks = [{name:'noao.digiphot.apphot.phot',package:'noao.digiphot.apphot'},{name:'flatcombine',package:'noao.imred.ccdred'}] as any
  const tree = taskPackageTree(tasks)
  expect(tree.map(n=>n.label)).toEqual(['noao'])
  expect(tree[0].children.map(n=>n.label)).toEqual(['digiphot','imred'])
  expect(tree[0].children[0].children[0].tasks[0].name).toBe('noao.digiphot.apphot.phot')
  expect(tree[0].children[0].children[0].path).toBe('noao.digiphot.apphot')
  expect(taskDisplayName('flatcombine')).toBe('flatcombine')
  expect(taskDisplayName('noao.digiphot.apphot.phot')).toBe('phot')
});
