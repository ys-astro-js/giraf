import { useState, useSyncExternalStore } from "react"
import { CircleX, TriangleAlert, Trash2, X } from "lucide-react"
import {
  copyDiagnosticRunId,
  diagnostics,
  type Diagnostic,
  type DiagnosticSeverity,
} from "@/lib/diagnostics"
import { toast } from "@/components/ui/toast"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Separator } from "@/components/ui/separator"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverTitle,
  PopoverDescription,
} from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Empty, EmptyDescription } from "@/components/ui/empty"

type Filter = DiagnosticSeverity | "all"
const labels = { all: "전체", warning: "경고", error: "오류" }
const timeFormat = new Intl.DateTimeFormat("ko-KR", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
})

export function DiagnosticsButton({
  resolveNode,
  onNavigate,
}: {
  resolveNode: (entry: Diagnostic) => string | undefined
  onNavigate: (nodeId: string) => void
}) {
  const entries = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.getSnapshot,
    diagnostics.getSnapshot
  )
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>("all")
  const counts = {
    all: entries.length,
    warning: entries.filter((entry) => entry.severity === "warning").length,
    error: entries.filter((entry) => entry.severity === "error").length,
  }
  const visibleSeverities = (["warning", "error"] as const).filter(
    (severity) => counts[severity] > 0
  )
  if (visibleSeverities.length === 0) return null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ButtonGroup className="shrink-0" aria-label="경고 및 오류">
        {visibleSeverities.map((severity) => {
          const Icon = severity === "warning" ? TriangleAlert : CircleX
          return (
            <PopoverTrigger
              key={severity}
              render={<Button variant="outline" />}
              onClick={() => setFilter(severity)}
              aria-label={`${labels[severity]} ${counts[severity]}개 보기`}
              title={`${labels[severity]} ${counts[severity]}개 보기`}
            >
              <Icon
                data-icon="inline-start"
                className={
                  severity === "warning" ? "text-warning" : "text-destructive"
                }
              />
              <span className="diagnostics-count tabular-nums">
                {counts[severity] > 999 ? "999+" : counts[severity]}
              </span>
            </PopoverTrigger>
          )
        })}
      </ButtonGroup>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="diagnostics-popover"
      >
        <PopoverTitle className="sr-only">경고 및 오류</PopoverTitle>
        <PopoverDescription className="sr-only">
          현재 세션에서 수집한 기록입니다.
        </PopoverDescription>
        <Tabs
          value={filter}
          onValueChange={(value) => setFilter(value as Filter)}
          className="min-h-0 gap-0"
        >
          <div className="diagnostics-toolbar">
            <TabsList aria-label="기록 종류">
              {(["all", "warning", "error"] as const).map((value) => (
                <TabsTrigger key={value} value={value}>
                  {labels[value]}
                </TabsTrigger>
              ))}
            </TabsList>
            <div className="flex shrink-0 items-center gap-1">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={!counts[filter]}
                aria-label={`${labels[filter]} 기록 비우기`}
                title={`${labels[filter]} 기록 비우기`}
                onClick={() => {
                  setOpen(false)
                  diagnostics.clear(filter === "all" ? undefined : filter)
                }}
              >
                <Trash2 />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="경고 및 오류 닫기"
                onClick={() => setOpen(false)}
              >
                <X />
              </Button>
            </div>
          </div>
          <Separator />
          {(["all", "warning", "error"] as const).map((value) => (
            <TabsContent
              key={value}
              value={value}
              className="diagnostics-content"
            >
              {counts[value] === 0 ? (
                <Empty className="px-4 py-6">
                  <EmptyDescription>
                    {value === "all"
                      ? "기록이 없습니다"
                      : `${labels[value]}가 없습니다`}
                  </EmptyDescription>
                </Empty>
              ) : (
                <ul
                  aria-label={`${labels[value]} 기록`}
                  className="diagnostics-list"
                >
                  {entries
                    .filter(
                      (entry) => value === "all" || entry.severity === value
                    )
                    .map((entry) => {
                      const Icon =
                        entry.severity === "warning" ? TriangleAlert : CircleX
                      const nodeId = resolveNode(entry)
                      const message = (
                        <>
                          <span className="sr-only">
                            {labels[entry.severity]}:{" "}
                          </span>
                          {entry.message}
                        </>
                      )
                      return (
                        <li key={entry.id} className="diagnostics-entry">
                          {nodeId && (
                            <button
                              type="button"
                              className="diagnostics-row-action"
                              aria-label={`${labels[entry.severity]}: ${entry.message} ${entry.source} 노드로 이동`}
                              title={`${entry.source} 노드로 이동`}
                              onClick={() => {
                                setOpen(false)
                                onNavigate(nodeId)
                              }}
                            />
                          )}
                          <Icon
                            aria-hidden="true"
                            className={
                              entry.severity === "warning"
                                ? "text-warning"
                                : "text-destructive"
                            }
                          />
                          <div className="flex min-w-0 flex-col gap-1">
                            <p className="leading-relaxed break-words whitespace-pre-wrap">
                              {message}
                            </p>
                            <div className="diagnostics-meta text-muted-foreground">
                              <span>{entry.source}</span>
                              <div className="diagnostics-meta-trailing">
                                {entry.runId && (
                                  <Button
                                    variant="ghost"
                                    size="xs"
                                    className="diagnostics-run-id shrink-0 px-0 tabular-nums"
                                    aria-label={`실행 ID ${entry.runId} 복사`}
                                    title={`전체 실행 ID 복사: ${entry.runId}`}
                                    onClick={async () => {
                                      try {
                                        await copyDiagnosticRunId(entry.runId!)
                                        toast.add({
                                          title: "실행 ID를 복사했습니다.",
                                          type: "success",
                                        })
                                      } catch {
                                        toast.add({
                                          title:
                                            "실행 ID를 복사하지 못했습니다. 클립보드 권한을 확인해 주세요.",
                                          type: "error",
                                        })
                                      }
                                    }}
                                  >
                                    {entry.runId.slice(-6)}
                                  </Button>
                                )}
                                <time
                                  dateTime={new Date(
                                    entry.timestamp
                                  ).toISOString()}
                                  className="tabular-nums"
                                >
                                  {timeFormat.format(entry.timestamp)}
                                </time>
                              </div>
                            </div>
                          </div>
                        </li>
                      )
                    })}
                </ul>
              )}
            </TabsContent>
          ))}
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
