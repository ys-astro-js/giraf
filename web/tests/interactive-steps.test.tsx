import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { WorkbenchToolbar } from "../src/components/workbench-toolbar"
import { SidebarProvider } from "../src/components/ui/sidebar"
import { OutputTableView } from "../src/features/viewer/OutputTableView"
import { outputTable } from "../src/lib/output-table"
import { advance, pressKey, startSession, useCursorSession } from "../src/lib/cursor-session"
import { jobTitle, plannedOutputs, type Job, type Spec } from "../src/lib/workbench"

const header = "# XCENTER YCENTER SKY SKYSIGMA FWHM COUNTS MAG"
const line = "32.25 30.75 100.0 2.50 4.73 85617.7 -12.331"

test("a task's printed table keeps its columns, INDEF and precision", () => {
  const table = outputTable(`\n${header}\n${line}\n33 31 INDEF INDEF 4.7 1.2D+4 INDEF\nERROR: no star\n`)!
  expect(table.columns).toEqual(["xcenter", "ycenter", "sky", "skysigma", "fwhm", "counts", "mag"])
  expect(table.rows).toEqual([line.split(" "), ["33", "31", "INDEF", "INDEF", "4.7", "1.2D+4", "INDEF"]])
  expect(outputTable("Image cursor: q")).toBeUndefined()
  const html = renderToStaticMarkup(<OutputTableView table={table} label="daoedit B 결과" />)
  for (const value of line.split(" ")) expect(html).toContain(value)
  expect(html).toContain('aria-label="daoedit B 결과"')
})

const waiting = (id: string): Job => ({
  id: "run", name: "daoedit", state: "waiting", message: "", count: 1, progress: 0, products: [],
  manifest: { interactive: true, cursor: { image: { click: "a", count: "측정한 별 {n}개", finish: { label: "측정 끝내기", keys: ["q"] } } } } as Job["manifest"],
  interaction: { id, kind: "imcur", prompt: "", state: "waiting" },
})

test("without a plot to accept, a clicked star counts once IRAF reads the image again", () => {
  startSession(null)
  const first = waiting("1")
  startSession(first)
  pressKey(first, "a", { view: { x: 10, y: 20 }, image: { x: 11, y: 21 } })
  expect(useCursorSession.getState().pending).toEqual({ x: 10, y: 20 })
  const next = waiting("2")
  startSession(next)
  advance(next)
  expect(useCursorSession.getState().used).toEqual([{ x: 10, y: 20 }])
  expect(useCursorSession.getState().pending).toBeNull()
  startSession(null)
})

test("workflow jobs are named by their node and round", () => {
  const job = waiting("1")
  expect(jobTitle(job)).toBe("daoedit")
  job.manifest = { ...job.manifest!, nodeLabel: "RDNOISE", round: { name: "B", regions: [] } }
  expect(jobTitle(job)).toBe("RDNOISE B")
})

test("edited copies keep their input's names", () => {
  const rows = [{ id: "m", label: "M67B.fits" }] as never
  const hedit = { name: "images.imutil.hedit", adapter: "generic", inputs: [{ name: "images" }],
    outputs: [{ name: "result", kind: "image", mode: "pass", from: "images", default: "*" }] } as unknown as Spec
  expect(plannedOutputs(hedit, { inputs: { images: ["m"] }, outputs: {}, parameters: {} } as never, rows)).toEqual([{ input: "M67B.fits", output: "M67B.fits" }])
  const ccdhedit = { name: "ccdhedit", inputs: [{ name: "images" }], output: { name: "images", mode: "edit", default: "h" }, kind: "image" } as unknown as Spec
  expect(plannedOutputs(ccdhedit, { inputs: { images: ["m"] }, output: { name: "h" }, parameters: {} } as never, rows)).toEqual([{ input: "M67B.fits", output: "M67B.fits" }])
})

test("a run paused for a measurement offers its window at the capsule's end", () => {
  const render = (onMeasure?: () => void) => renderToStaticMarkup(
    <SidebarProvider>
      <WorkbenchToolbar
        executionStatus={{ name: "daoedit B", detail: "측정 기다리는 중", label: "사용자 입력 대기", state: "waiting", progress: "1/7" }}
        folder="/m67" ready loading={false} onHome={() => {}} workflowBusy runDisabled={false}
        onRun={() => {}} onCancel={() => {}} onMeasure={onMeasure} trayOpen={false} onTray={() => {}} columnOpen onColumn={() => {}}
      />
    </SidebarProvider>
  )
  const html = render(() => {})
  expect(html).toContain("측정 기다리는 중")
  expect(html).toContain('aria-label="측정 창 열기"')
  expect(html).toContain("lucide-clock")
  expect(html).not.toContain("lucide-circle-pause")
  expect(render()).not.toContain("측정 창 열기")
})
