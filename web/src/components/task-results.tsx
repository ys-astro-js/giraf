import { RevealFile, ViewerToolButton } from "@/components/viewer-controls"
import { matchesFileName } from "@/lib/file-library"
import { useEffect, useState, type ReactNode } from "react"
import { Check, Maximize2, X } from "lucide-react"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { ButtonGroup } from "@/components/ui/button-group"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ImageViewer } from "@/components/image-viewer"
import { Blank, Failure } from "@/components/workbench-controls"
import { api, type Frame, type Job } from "@/lib/workbench"
import { stateLabel, type TaskMap, type Instance } from "@/lib/task-map"

function ResultPreview({
  frame,
  actions,
}: {
  frame: Frame
  actions?: ReactNode
}) {
  const [text, setText] = useState<string | null>(null),
    [error, setError] = useState(""),
    [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setText(null)
    setError("")
    if (["text", "image-list"].includes(frame.asset || ""))
      api<{ text: string }>("text?id=" + encodeURIComponent(frame.id))
        .then((r) => {
          if (!cancelled) setText(r.text)
        })
        .catch((e) => {
          if (!cancelled) setError(e.message)
        })
    return () => {
      cancelled = true
    }
  }, [frame.id, frame.asset, attempt])
  return (
    <div className="result-preview">
      {frame.asset && frame.asset !== "image" && (
        <header className="result-preview-heading">
          <h3 className="min-w-0 truncate" title={frame.label}>
            {frame.label}
          </h3>
          <ButtonGroup aria-label="파일 동작">
            <RevealFile id={frame.id} />
            {actions}
          </ButtonGroup>
        </header>
      )}
      {error ? (
        <>
          <Failure message={error} />
          <Button variant="outline" onClick={() => setAttempt((v) => v + 1)}>
            다시 불러오기
          </Button>
        </>
      ) : ["text", "image-list"].includes(frame.asset || "") ? (
        <>
          {text === null ? (
            <p role="status">결과를 불러오는 중입니다.</p>
          ) : (
            <pre className="result-text">{text}</pre>
          )}
        </>
      ) : frame.asset === "plot" ? (
        <>
          <img
            key={attempt}
            src={"/api/plot?id=" + encodeURIComponent(frame.id)}
            alt={frame.label}
            onError={() =>
              setError("결과 그래프를 불러오지 못했습니다. 다시 시도해 주세요.")
            }
          />
        </>
      ) : frame.asset === "metacode" || frame.asset === "binary" ? (
        <p>
          {frame.asset === "metacode"
            ? "IRAF graphics metacode (GKI)"
            : "Binary file"}
        </p>
      ) : !frame.asset || frame.asset === "image" ? (
        <>
          <ImageViewer
            key={attempt}
            frame={frame}
            headerActions={actions}
            onReload={() => setAttempt((value) => value + 1)}
          />
        </>
      ) : (
        <>
          <p>
            이 파일은 미리보기를 지원하지 않습니다. 파일 위치를 열어 확인해
            주세요.
          </p>
        </>
      )}
    </div>
  )
}
export function TaskResults({
  map,
  task,
  job,
}: {
  map: TaskMap
  task: Instance
  job?: Job
}) {
  const recorded = map.runs.filter((r) => r.instanceId === task.id).at(-1)
  // A supplied job may still be an older selection in the global history tray.
  const run =
    recorded || (job?.manifest?.instanceId === task.id ? job : undefined)
  const products = run?.products || []
  const [selection, setSelection] = useState(""),
    [query, setQuery] = useState("")
  const selected = products.find((p) => p.id === selection) || products[0]
  const visible = products.filter((p) => matchesFileName(p, query))
  return (
    <section className="task-results" aria-label={`${task.label} 결과 패널`}>
      <header className="result-heading">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2">
            {`결과 ${products.length}개`}
          </h3>
          <span className="text-muted-foreground">
            {run ? stateLabel(run.state) : "실행 전"}
          </span>
        </div>
        {run && (
          <p className="result-run" title={run.id}>
            {run.id}
          </p>
        )}
      </header>
      {!run ? (
        <Blank>아직 실행하지 않았습니다. 설정에서 작업을 실행해 주세요.</Blank>
      ) : !products.length ? (
        <Blank>
          {run.state === "failed"
            ? "실행에 실패했습니다. 실행 기록의 로그를 확인한 뒤 다시 실행해 주세요."
            : ["running", "queued", "waiting"].includes(run.state)
              ? "실행 중입니다. 생성된 결과가 여기에 표시됩니다."
              : run.state === "cancelled"
                ? "실행이 중단되었습니다. 생성된 결과 파일이 없습니다."
                : "생성된 결과 파일이 없습니다."}
        </Blank>
      ) : (
        <div className="result-workspace">
          <div className="result-browser">
            {products.length > 8 && (
              <Input
                aria-label="결과 파일 검색"
                placeholder="파일명 검색"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            <div className="result-files" aria-label="결과 파일 목록">
              {visible.map((p) => (
                <Button
                  key={p.id}
                  variant={selected?.id === p.id ? "secondary" : "ghost"}
                  className="result-file"
                  aria-pressed={selected?.id === p.id}
                  onClick={() => setSelection(p.id)}
                  title={p.label}
                >
                  <Check
                    data-icon="inline-start"
                    className={selected?.id === p.id ? "" : "invisible"}
                  />
                  <span className="truncate">{p.label}</span>
                </Button>
              ))}
            </div>
            {!visible.length && (
              <p role="status">검색 조건에 맞는 결과가 없습니다.</p>
            )}
          </div>
          {selected && (
            <Dialog>
              <ResultPreview
                frame={selected}
                actions={
                  <DialogTrigger
                    render={<ViewerToolButton label="크게 보기" />}
                  >
                    <Maximize2 />
                  </DialogTrigger>
                }
              />
              <DialogContent
                className="result-preview-dialog"
                showCloseButton={false}
              >
                <DialogTitle className="sr-only">
                  {selected.label} 미리보기
                </DialogTitle>
                <ResultPreview
                  frame={selected}
                  actions={
                    <DialogClose render={<ViewerToolButton label="닫기" />}>
                      <X />
                    </DialogClose>
                  }
                />
              </DialogContent>
            </Dialog>
          )}
        </div>
      )}
    </section>
  )
}
