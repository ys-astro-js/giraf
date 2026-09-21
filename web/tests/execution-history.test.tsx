import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { groupExecutions } from "../src/lib/execution-history"
import { LibrarySidebar } from "../src/components/library-sidebar"
import { SidebarProvider } from "../src/components/ui/sidebar"
import { RunHistory } from "../src/components/run-history"
import type { Job } from "../src/lib/workbench"
const job = (id: string, workflowId?: string) =>
  ({
    id,
    name: "imcopy",
    state: "completed",
    products: [],
    manifest: workflowId ? { workflowId } : undefined,
  }) as Job

test("one click groups its jobs in execution order and repeated clicks stay separate", () => {
  const groups = groupExecutions([
    job("20260921-120003-c", "second"),
    job("20260921-120002-b", "first"),
    job("20260921-120001-a", "first"),
    job("20260921-110000-single"),
  ])
  expect(groups.map((g) => g.jobs.map((j) => j.id))).toEqual([
    ["20260921-120003-c"],
    ["20260921-120001-a", "20260921-120002-b"],
    ["20260921-110000-single"],
  ])
  expect(groups[1].workflow).toBe(true)
  expect(groups[2].workflow).toBe(false)
  const early = {
    ...job("20260921-120000-z", "same"),
    manifest: { workflowId: "same", workflowStep: 0 },
  } as Job
  const late = {
    ...job("20260921-120000-a", "same"),
    manifest: { workflowId: "same", workflowStep: 1 },
  } as Job
  expect(groupExecutions([late, early])[0].jobs.map((j) => j.id)).toEqual([
    early.id,
    late.id,
  ])
})
test("legacy current workflow membership groups jobs without guessing from their timestamps", () => {
  const jobs = [job("b"), job("a"), job("other")]
  expect(
    groupExecutions(jobs, {
      id: "legacy",
      jobs: [jobs[1]],
      currentJob: jobs[0],
    }).map((g) => g.jobs.map((j) => j.id))
  ).toEqual([["other"], ["a", "b"]])
  expect(groupExecutions([])).toEqual([])
})
test("failed jobs without outputs remain in history", () => {
  expect(
    groupExecutions([{ ...job("a", "run"), state: "failed" }])[0].jobs[0].state
  ).toBe("failed")
})
test("file tab offers four destinations and excludes generated outputs and settings", () => {
  const html = renderToStaticMarkup(
    <SidebarProvider>
      <LibrarySidebar
        workspace={{
          folder: "/data",
          files: [
            { id: "source", label: "source.fits" },
            { id: "output", label: "output.fits", job: "run" },
          ],
          sets: [{name: "obsolete saved set", ids: ["source"], folder: "/data"}],
        }}
        catalog={null}
        jobs={[]}
        ready
        loadError={false}
        selected={[]}
        onSelect={() => {}}
        onOpen={() => {}}
        onRefresh={async () => {}}
        onError={() => {}}
        onAddTask={() => {}}
        onUse={() => {}}
        onDeleteFiles={async () => {}}
        onDeleteJobs={async () => {}}
        onViewLog={() => {}}
      >
        <span>실행 엔진</span>
      </LibrarySidebar>
    </SidebarProvider>
  )
  for (const label of ["파일", "실행 기록", "작업", "설정"])
    expect(html).toContain(`>${label}</span>`)
  for (const icon of [
    "folder-closed",
    "square-function",
    "sliders-horizontal",
  ])
    expect(html).toContain(`lucide-${icon}`)
  expect(html).toContain("source.fits")
  expect(html).not.toContain("표시된 파일 전체 선택")
  expect(html).toContain("파일 선택 모드")
  expect(html).toContain("1개 항목")
  expect(html).not.toContain("선택한 파일 삭제")
  expect(html).not.toContain("저장한 선택")
  expect(html).not.toContain("obsolete saved set")
  expect(html).not.toContain("묶음 저장")
  expect(html).not.toContain("output.fits")
  expect(html).not.toContain("실행 엔진")
  expect(html).not.toContain("열린 폴더")
  expect(html).toContain('data-selecting="false"')
  expect(html).toContain("library-file-checkbox")
})
test("external log request directly renders the selected job log", () => {
  const html = renderToStaticMarkup(
    <RunHistory
      jobs={[{ ...job("a"), log: "specific log" }]}
      initialDetail={{ id: "a", kind: "log" }}
      onSelect={() => {}}
      onOpen={() => {}}
      onCancel={() => {}}
    />
  )
  expect(html).toContain("specific log")
  expect(html).not.toContain("실행 기록 목록")
})

test("persisted execution memberships remain grouped when another workflow becomes current", () => {
  const saved = [
    { ...job("b"), execution: { id: "old", step: 1 } },
    { ...job("a"), execution: { id: "old", step: 0 } },
  ]
  expect(
    groupExecutions(saved, {
      id: "new",
      jobs: [],
      currentJob: null,
    })[0].jobs.map((j) => j.id)
  ).toEqual(["a", "b"])
  expect(groupExecutions(saved)[0].id).toBe("workflow:old")
})
