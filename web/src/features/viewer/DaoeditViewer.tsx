import { useEffect, useRef, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { Download, LoaderCircle, Square } from "lucide-react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ImageViewer } from "./ImageViewer"
import { DaoeditMeasurements } from "./DaoeditMeasurements"
import { ViewerToolButton } from "./controls"
import {
  daoeditPayload,
  parseDaoedit,
  type DaoeditMeasurement,
  type DaoeditSession,
} from "@/lib/daoedit"
import { api, type Job } from "@/lib/workbench"
import { activeJob, jobQueryOptions } from "@/lib/queries"
import "@/styles/viewer/daoedit.css"

export function DaoeditViewer({
  session,
  onClose,
  onStart,
}: {
  session: DaoeditSession
  onClose: () => void
  onStart: (payload: unknown) => Promise<Job | undefined>
}) {
  const queryClient = useQueryClient()
  const [measurements, setMeasurements] = useState<DaoeditMeasurement[]>([])
  const [selected, setSelected] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [jobId, setJobId] = useState("")
  const [outputId, setOutputId] = useState("")
  const locked = useRef(false)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  async function measure(x: number, y: number) {
    if (locked.current) return
    locked.current = true
    setBusy(true)
    setError("")
    setJobId("")
    try {
      let job = await onStart(daoeditPayload(session, x, y))
      if (!job)
        throw new Error(
          "측정을 시작하지 못했습니다. 입력 영상과 실행 설정을 확인해 주세요."
        )
      if (!alive.current) return
      setJobId(job.id)
      while (activeJob(job)) {
        await new Promise((resolve) => setTimeout(resolve, 400))
        if (!alive.current) return
        job = await queryClient.fetchQuery(jobQueryOptions(job.id))
      }
      if (!alive.current) return
      if (job.state !== "completed")
        throw new Error(
          job.state === "cancelled"
            ? "측정을 중단했습니다. 다른 별을 선택할 수 있습니다."
            : "측정에 실패했습니다. 실행 기록의 로그를 확인해 주세요."
        )
      const output = job.products.find((p) => p.role === "$stdout")
      if (!output)
        throw new Error(
          "측정 결과가 없습니다. 별 가까운 위치를 다시 선택해 주세요."
        )
      const result = await api<{ text: string }>(
        `text?id=${encodeURIComponent(output.id)}`
      )
      if (!alive.current) return
      const rows = parseDaoedit(result.text)
      if (!rows.length)
        throw new Error(
          "측정값을 읽지 못했습니다. 실행 기록의 결과 파일을 확인해 주세요."
        )
      setSelected(measurements.length)
      setMeasurements((previous) => [...previous, ...rows])
      setOutputId(output.id)
    } catch (e) {
      if (alive.current) setError((e as Error).message)
    } finally {
      locked.current = false
      if (alive.current) setBusy(false)
    }
  }

  const markers = measurements.flatMap((row, index) => {
    const x = Number(row.xcenter),
      y = Number(row.ycenter)
    return Number.isFinite(x) && Number.isFinite(y)
      ? [{ x, y, label: String(index + 1) }]
      : []
  })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="daoedit-dialog" aria-describedby={undefined}>
        <header className="daoedit-header">
          <DialogTitle>daoedit</DialogTitle>
          <span
            className="truncate text-muted-foreground"
            title={session.frame.label}
          >
            {session.frame.label}
          </span>
        </header>
        <div className="daoedit-image">
          <ImageViewer
            frame={session.frame}
            embedded
            onPick={(x, y) => {
              void measure(x, y)
            }}
            markers={markers}
            selectedMarker={
              selected === null ? undefined : String(selected + 1)
            }
          />
        </div>
        <section
          className="daoedit-results"
          aria-label="별 측정 결과"
          aria-busy={busy}
        >
          <div className="daoedit-status">
            {busy && (
              <LoaderCircle
                className="size-4 animate-spin motion-reduce:animate-none"
                role="status"
                aria-label="측정 중"
              />
            )}
            <div className="ml-auto flex shrink-0 gap-2">
              {busy && jobId && (
                <ViewerToolButton
                  label="측정 중단"
                  onClick={() => {
                    void api("task-cancel", { id: jobId }).catch((e) =>
                      setError(e.message)
                    )
                  }}
                >
                  <Square />
                </ViewerToolButton>
              )}
              {!busy && outputId && (
                <ViewerToolButton
                  label="최근 측정 결과 다운로드"
                  render={
                    <a
                      href={`/api/download?id=${encodeURIComponent(outputId)}`}
                      download
                    />
                  }
                >
                  <Download />
                </ViewerToolButton>
              )}
            </div>
          </div>
          {error && (
            <p role="alert" className="px-4 pb-3 text-destructive">
              {error}
            </p>
          )}
          <div className="daoedit-table">
            <DaoeditMeasurements
              measurements={measurements}
              selected={selected}
              onSelect={setSelected}
            />
          </div>
        </section>
      </DialogContent>
    </Dialog>
  )
}
