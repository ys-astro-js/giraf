// Behavior contracts defined before the punctuation and search refinement.
import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { LibrarySidebar } from "../src/components/library-sidebar"
import { SidebarProvider } from "../src/components/ui/sidebar"
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

test("file pagination exposes remaining quantity in a Badge with a separate filter control", () => {
  const noop = () => {}
  const files = Array.from({ length: 84 }, (_, i) => ({
    id: String(i),
    label: `image-${i}.fits`,
    asset: "image",
  }))
  const html = renderToStaticMarkup(
    <SidebarProvider>
      <LibrarySidebar
        onViewLog={()=>{}}
        workspace={{ folder: "/data", files, sets: [] }}
        catalog={null}
        jobs={[]}
        ready
        selected={[]}
        onSelect={noop}
        onOpen={noop}
        onRefresh={async () => {}}
        onError={noop}
        onAddTask={noop}
        onUse={noop}
        onSave={noop}
      >
        {null}
      </LibrarySidebar>
    </SidebarProvider>
  )
  expect(html).toContain('placeholder="파일명 검색"')
  expect(html).toContain('aria-label="파일 필터"')
  expect(html).toMatch(/더 보기\s*<span[^>]*data-slot="badge"[^>]*>4<\/span>/)
  expect(html).not.toContain("더 보기 (4)")
  expect(html).toContain("파일 84개")
  expect(html.match(/data-slot="badge"/g)).toHaveLength(1)
})

test('task display names omit package paths while history retains qualified identity in tooltips', async () => {
  const { taskDisplayName } = await import('../src/lib/workbench')
  const { taskPackageTree } = await import('../src/lib/task-tree')
  const tasks = [{name:'noao.digiphot.apphot.phot',package:'noao.digiphot.apphot'},{name:'flatcombine',package:'noao.imred.ccdred'}] as any
  const tree = taskPackageTree(tasks)
  expect(tree.map(n=>n.label)).toEqual(['noao'])
  expect(tree[0].children.map(n=>n.label)).toEqual(['digiphot','imred'])
  expect(tree[0].children[0].children[0].tasks[0].name).toBe('noao.digiphot.apphot.phot')
  expect(tree[0].children[0].children[0].path).toBe('noao.digiphot.apphot')
  const { RunHistory } = await import('../src/components/run-history')
  expect(taskDisplayName('flatcombine')).toBe('flatcombine')
  expect(taskDisplayName('noao.digiphot.apphot.phot')).toBe('phot')
  const html=renderToStaticMarkup(<RunHistory jobs={[{id:'run',name:'noao.digiphot.apphot.phot',task:'noao.digiphot.apphot.phot',products:[],state:'completed',message:'',count:0}]} onSelect={()=>{}} onOpen={()=>{}} onCancel={()=>{}}/>);
  expect(html).toContain('>phot</span>')
  expect(html).not.toContain('>noao.digiphot.apphot.phot</span>')
  expect(html).toContain('title="noao.digiphot.apphot.phot"')
});
