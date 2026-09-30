import { useMemo, useState } from "react"
import {
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { DeleteSelectionButton } from "@/components/delete-selection-button"
import { groupExecutions } from "@/lib/execution-history"
import { useWorkbench } from "@/features/workbench/context"
import { LibraryHistory } from "./History"
import { ListBar, ListSkeleton, NoFiles } from "./shared"
import { useFileList } from "./lists"

const ACTIVE = ["queued", "running", "waiting"]

/** Past runs grouped by execution, with their logs and products. */
export function RunsPanel() {
  const w = useWorkbench()
  const [runOpen, setRunOpen] = useState<Record<string, boolean>>({})
  // Runs are selected for deletion; their products, like folder files.
  const [mode, setMode] = useState<"runs" | "files" | null>(null)
  const [selectedRuns, setSelectedRuns] = useState<string[]>([])
  const selected = w.selectedFiles
  const [previousSelected, setPreviousSelected] = useState(selected)
  if (previousSelected !== selected) {
    setPreviousSelected(selected)
    if (mode === "files" && previousSelected.length && !selected.length)
      setMode(null)
  }
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const { fileList } = useFileList({
    selected: selectedSet,
    selecting: mode === "files",
    onSelect: (value) => {
      setMode("files")
      w.setSelectedFiles(value)
    },
    onOpen: w.assetViewer.open,
  })
  const products = w.jobs.flatMap((job) => job.products)
  const executions = groupExecutions(w.jobs, w.workflow)
  const deletableRuns = executions.filter(
    (group) => !group.jobs.some((job) => ACTIVE.includes(job.state))
  )
  const runSelection = deletableRuns.filter((group) =>
    selectedRuns.includes(group.id)
  )
  function done() {
    setMode(null)
    setSelectedRuns([])
    w.setSelectedFiles([])
  }
  const files = mode === "files"
  return (
    <TooltipProvider delay={0}>
      <div className="library-window">
        <SidebarHeader>
          <ListBar
            label="실행 기록 관리"
            count={executions.length}
            selection={{
              active: mode !== null,
              selectedCount: files ? selected.length : runSelection.length,
              allLabel: files ? "표시된 파일 전체 선택" : "실행 기록 전체 선택",
              allChecked: files
                ? products.length > 0 &&
                  products.every((file) => selectedSet.has(file.id))
                : deletableRuns.length > 0 &&
                  runSelection.length === deletableRuns.length,
              someChecked: files
                ? products.some((file) => selectedSet.has(file.id))
                : runSelection.length > 0,
              allDisabled:
                !w.ready || !(files ? products.length : deletableRuns.length),
              onAll: (checked) =>
                files
                  ? w.setSelectedFiles((ids) =>
                      checked
                        ? [
                            ...new Set([
                              ...ids,
                              ...products.map((file) => file.id),
                            ]),
                          ]
                        : ids.filter(
                            (id) => !products.some((file) => file.id === id)
                          )
                    )
                  : setSelectedRuns(
                      checked ? deletableRuns.map((group) => group.id) : []
                    ),
              onDone: done,
              startLabel: "실행 기록 선택 모드",
              startDisabled: !w.ready || !deletableRuns.length,
              onStart: () => setMode("runs"),
            }}
          />
        </SidebarHeader>
        <SidebarContent
          className="scroll-fade scroll-fade-4"
          aria-busy={!w.ready && !w.loadError}
        >
          {w.loadError ? (
            <NoFiles>자료를 불러오지 못했습니다.</NoFiles>
          ) : !w.ready ? (
            <ListSkeleton />
          ) : (
            <LibraryHistory
              executions={executions}
              runOpen={runOpen}
              setRunOpen={setRunOpen}
              selecting={mode === "runs"}
              runSelection={runSelection}
              deletableRuns={deletableRuns}
              onSelectMode={() => setMode("runs")}
              setSelectedRuns={setSelectedRuns}
              onViewLog={w.viewLog}
              fileList={fileList}
            />
          )}
        </SidebarContent>
        {mode && (
          <SidebarFooter>
            <div
              className="flex min-h-9 flex-wrap items-center justify-end gap-4"
              role="group"
              aria-label={files ? "선택한 파일 작업" : "선택한 실행 기록 작업"}
            >
              {files && (
                <Button
                  className="min-w-0 flex-1"
                  disabled={!selected.length}
                  onClick={() => w.setAddOpen(true)}
                >
                  작업에 사용
                </Button>
              )}
              <DeleteSelectionButton
                ids={files ? selected : runSelection.map((group) => group.id)}
                label={files ? "선택한 파일 삭제" : "선택한 실행 기록 삭제"}
                description={
                  files
                    ? "휴지통에서 복원할 수 있습니다."
                    : "산출물도 함께 이동합니다. 원본 파일은 유지됩니다."
                }
                onDelete={async (ids) => {
                  if (files) await w.deleteLibrary("files", ids)
                  else
                    await w.deleteLibrary(
                      "jobs",
                      executions
                        .filter((group) => ids.includes(group.id))
                        .flatMap((group) => group.jobs.map((job) => job.id))
                    )
                  done()
                }}
              />
            </div>
          </SidebarFooter>
        )}
      </div>
    </TooltipProvider>
  )
}
