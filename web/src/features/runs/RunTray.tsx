import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react"
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  LoaderCircle,
  Square,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Blank } from "@/components/workbench-controls"
import { DeleteSelectionButton } from "@/components/delete-selection-button"
import { FileTable } from "@/features/file-picker/FileList"
import { useWorkbench } from "@/features/workbench/context"
import { resizeTray, useDock } from "@/features/dock/store"
import { useLayout } from "@/features/workbench/layout-store"
import { groupExecutions, type ExecutionGroup } from "@/lib/execution-history"
import { runLabel } from "@/lib/file-library"
import { stateLabel } from "@/lib/task-map"
import { api, taskDisplayName, type Job } from "@/lib/workbench"
import "@/styles/library/history.css"

const ACTIVE = ["queued", "running", "waiting"]
/** The workbench keeps at least this much height above the tray. */
const MIN_WORKBENCH = 200

function JobState({ state }: { state: string }) {
  const Icon =
    state === "completed"
      ? CircleCheck
      : state === "failed"
        ? CircleX
        : state === "partial"
          ? CircleAlert
          : state === "cancelled" || state === "skipped"
            ? CircleMinus
            : state === "running"
              ? LoaderCircle
              : Clock
  return (
    <Icon
      role="img"
      aria-label={stateLabel(state)}
      className={state === "running" ? "run-state animate-spin" : "run-state"}
      data-state={state}
    >
      <title>{stateLabel(state)}</title>
    </Icon>
  )
}

/** A run id's time, short: "10/01 13:45:57". */
function runTime(id: string) {
  return /^\d{8}-\d{6}/.test(id)
    ? `${id.slice(4, 6)}/${id.slice(6, 8)} ${id.slice(9, 11)}:${id.slice(11, 13)}:${id.slice(13, 15)}`
    : runLabel(id)
}

const jobName = (job: Job) => taskDisplayName(job.task || job.name)
const groupName = (group: ExecutionGroup) =>
  group.workflow ? "워크플로우 실행" : `${jobName(group.jobs[0])} 실행`

/** A job to select in the run list. */
function JobRow({
  job,
  selected,
  nested,
  onSelect,
}: {
  job: Job
  selected: boolean
  nested?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      className="run-row"
      data-job={job.id}
      data-nested={nested || undefined}
      aria-current={selected || undefined}
      onClick={onSelect}
    >
      <JobState state={job.state} />
      <span className="run-row-name" title={job.task || job.name}>
        {jobName(job)}
      </span>
      {!nested && (
        <span className="run-row-time" title={runLabel(job.id)}>
          {runTime(job.id)}
        </span>
      )}
    </button>
  )
}

/** Runs, newest first: a workflow run opens to the jobs it ran. */
function RunList({
  executions,
  selected,
  onSelect,
}: {
  executions: ExecutionGroup[]
  selected?: Job
  onSelect: (job: Job) => void
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  if (!executions.length) return <Blank>실행 기록이 없습니다</Blank>
  return (
    <ul className="run-list" aria-label="실행 목록">
      {executions.map((group) => {
        if (!group.workflow)
          return (
            <li key={group.id}>
              <JobRow
                job={group.jobs[0]}
                selected={selected?.id === group.jobs[0].id}
                onSelect={() => onSelect(group.jobs[0])}
              />
            </li>
          )
        const holds = group.jobs.some((job) => job.id === selected?.id)
        const expanded = open[group.id] ?? holds
        const current =
          group.jobs.find((job) => ACTIVE.includes(job.state)) ??
          group.jobs[group.jobs.length - 1]
        return (
          <li key={group.id}>
            <button
              type="button"
              className="run-row"
              aria-expanded={expanded}
              onClick={() => {
                setOpen((state) => ({ ...state, [group.id]: !expanded }))
                if (!expanded && !holds) onSelect(current)
              }}
            >
              <ChevronRight aria-hidden="true" className="run-row-chevron" />
              <span className="run-row-name">{groupName(group)}</span>
              <span className="run-row-count">{group.jobs.length}</span>
              <span className="run-row-time" title={runLabel(group.jobs[0].id)}>
                {runTime(group.jobs[0].id)}
              </span>
            </button>
            {expanded && (
              <ul>
                {group.jobs.map((job) => (
                  <li key={job.id}>
                    <JobRow
                      job={job}
                      nested
                      selected={selected?.id === job.id}
                      onSelect={() => onSelect(job)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}

type Detail = "log" | "products" | "settings"

/** The selected job: its log, what it produced, and how it ran. */
function RunDetail({
  job,
  execution,
}: {
  job: Job
  execution?: ExecutionGroup
}) {
  const w = useWorkbench()
  const [detail, setDetail] = useState<Detail>("log")
  const active = ACTIVE.includes(job.state)
  // A running log follows its end like a terminal, until scrolled up.
  const content = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  useLayoutEffect(() => {
    const element = content.current
    if (element && active && following.current)
      element.scrollTop = element.scrollHeight
  }, [job.log, active, detail])
  const removable =
    execution && !execution.jobs.some((item) => ACTIVE.includes(item.state))
  return (
    <div className="run-detail">
      <header className="run-detail-bar">
        <Tabs
          value={detail}
          onValueChange={(value) => setDetail(value as Detail)}
        >
          <TabsList>
            <TabsTrigger value="log">로그</TabsTrigger>
            <TabsTrigger value="products">
              {`산출물 ${job.products.length}`}
            </TabsTrigger>
            <TabsTrigger value="settings">실행 설정</TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="run-detail-title" title={job.task || job.name}>
          <strong>{jobName(job)}</strong>
          <span>{stateLabel(job.state)}</span>
        </span>
        {active && (
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              api("task-cancel", { id: job.id }).catch((e) =>
                w.setError(e.message)
              )
            }
          >
            <Square data-icon="inline-start" />
            중단
          </Button>
        )}
        {removable && (
          <DeleteSelectionButton
            ids={execution.jobs.map((item) => item.id)}
            label={`${groupName(execution)} 기록 삭제`}
            description="산출물도 함께 이동합니다. 원본 파일은 유지됩니다."
            onDelete={(ids) => w.deleteLibrary("jobs", ids)}
          />
        )}
      </header>
      <div
        key={`${job.id}:${detail}`}
        ref={content}
        onScroll={(e) => {
          const element = e.currentTarget
          following.current =
            element.scrollHeight - element.scrollTop - element.clientHeight < 24
        }}
        className="run-detail-content"
        tabIndex={0}
        aria-label={
          detail === "log"
            ? "로그"
            : detail === "products"
              ? "산출물"
              : "실행 설정"
        }
      >
        {detail === "log" ? (
          <>
            <pre>{job.log || job.message || "로그가 없습니다."}</pre>
            {job.outcomes?.map((outcome, i) => (
              <details key={i}>
                <summary>{outcome.label}</summary>
                <pre>{outcome.message}</pre>
              </details>
            ))}
          </>
        ) : detail === "products" ? (
          <FileTable
            busy={false}
            list={job.products}
            onActivate={w.assetViewer.open}
            activateLabel={(file) => `${file.label} 뷰어에서 열기`}
            empty="산출물이 없습니다"
          />
        ) : (
          <>
            <pre>{job.commands || "실행 명령이 없습니다."}</pre>
            <details>
              <summary>전체 설정</summary>
              <pre>
                {JSON.stringify(job.effective || job.manifest, null, 2)}
              </pre>
            </details>
            {!!job.headerDiff?.length && (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>헤더 키</TableHead>
                    <TableHead>변경 전</TableHead>
                    <TableHead>변경 후</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {job.headerDiff.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell>{row.key}</TableCell>
                      <TableCell>{row.before ?? "없음"}</TableCell>
                      <TableCell>{row.after ?? "삭제됨"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The run tray below the workbench: runs on the left, the selected one's
 * log and products on the right. Its top edge resizes it; the height stays
 * in pixels.
 */
export function RunTray() {
  const w = useWorkbench()
  const tray = useDock((state) => state.tray)
  const executions = groupExecutions(w.jobs, w.workflow)
  const selected = w.jobs.find((job) => job.id === w.selectedJob)
  const execution = executions.find((group) =>
    group.jobs.some((job) => job.id === selected?.id)
  )
  // A log asked for elsewhere (useLayout().viewLog) selects its job here.
  const logRequest = useLayout((state) => state.logRequest)
  const select = w.setSelectedJob
  const shown = useLayout((state) => state.logRevision)
  useEffect(() => {
    if (!logRequest) return
    select(logRequest.id)
    useLayout.getState().clearLog()
  }, [logRequest, select])
  function startResize(event: PointerEvent<HTMLDivElement>) {
    const body = event.currentTarget.closest(".dock-body")
    if (!body) return
    event.preventDefault()
    const start = event.clientY
    const from = tray.height
    const most = body.getBoundingClientRect().height - MIN_WORKBENCH
    const height = (y: number) => Math.min(most, from + start - y)
    const move = (e: globalThis.PointerEvent) => resizeTray(height(e.clientY))
    const end = (e: globalThis.PointerEvent) => {
      resizeTray(height(e.clientY), true)
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", end)
      document.body.removeAttribute("data-resizing")
    }
    document.body.setAttribute("data-resizing", "y")
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", end)
  }
  if (!tray.open) return null
  return (
    <section
      className="run-tray"
      aria-label="실행 기록"
      style={{ height: tray.height }}
    >
      <div
        className="run-tray-handle"
        role="separator"
        aria-orientation="horizontal"
        aria-label="실행 기록 높이 조절"
        onPointerDown={startResize}
      />
      <div className="run-tray-list">
        <RunList
          executions={executions}
          selected={selected}
          onSelect={(job) => w.setSelectedJob(job.id)}
        />
      </div>
      {selected ? (
        <RunDetail
          key={`${selected.id}:${shown}`}
          job={selected}
          execution={execution}
        />
      ) : (
        <Blank>실행을 선택하면 로그와 산출물이 여기에 표시됩니다</Blank>
      )}
    </section>
  )
}
