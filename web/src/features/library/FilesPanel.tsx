import { useMemo, useState } from "react"
import {
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/search-field"
import { FileFilterButton } from "@/components/file-filter-button"
import { DeleteSelectionButton } from "@/components/delete-selection-button"
import {
  type FileFilters,
  defaultFileFilters,
  filterFiles,
  partitionFiles,
} from "@/lib/file-library"
import { useWorkbench } from "@/features/workbench/context"
import { WindowControls } from "@/features/dock/WindowControls"
import { ListBar, ListSkeleton, NoFiles, RefreshButton } from "./shared"
import { useFileList, useRefresh } from "./lists"

/** The working folder's files: search, filter, select and open. */
export function FilesPanel() {
  const w = useWorkbench()
  const selected = w.selectedFiles
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<FileFilters>(defaultFileFilters)
  const [selecting, setSelecting] = useState(false)
  const [previousSelected, setPreviousSelected] = useState(selected)
  if (previousSelected !== selected) {
    setPreviousSelected(selected)
    if (selecting && previousSelected.length && !selected.length)
      setSelecting(false)
  }
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const { fileList, resetLimits } = useFileList({
    selected: selectedSet,
    selecting,
    onSelect: (value) => {
      setSelecting(true)
      w.setSelectedFiles(value)
    },
    onOpen: w.assetViewer.open,
  })
  const { refreshing, refresh } = useRefresh(w.refresh, w.setError)
  const source = useMemo(
    () => partitionFiles(w.workspace.files),
    [w.workspace.files]
  )
  const folder = filterFiles(source.folder, query, filters)
  const filterCount =
    Number(filters.kind !== "all") +
    Number(filters.band !== "all") +
    Number(!!(filters.minExposure || filters.maxExposure))
  const narrowed = !!query.trim() || filterCount > 0
  const bands = [
    ...new Set(
      source.folder
        .map((file) => file.filter)
        .filter((value): value is string => !!value)
    ),
  ].sort()
  const allChecked =
    folder.length > 0 && folder.every((file) => selectedSet.has(file.id))
  function done() {
    setSelecting(false)
    w.setSelectedFiles([])
  }
  return (
    <TooltipProvider delay={0}>
      <div className="library-window">
        <SidebarHeader>
          <div className="flex min-w-0 items-center gap-2">
            <WindowControls />
            <SearchField
              className="min-w-0 flex-1"
              label="파일명 검색"
              value={query}
              onValueChange={(value) => {
                setQuery(value)
                resetLimits()
              }}
            />
            <FileFilterButton
              filters={filters}
              bands={bands}
              onChange={(next) => {
                setFilters(next)
                resetLimits()
              }}
            />
          </div>
          <ListBar
            label="파일 관리"
            count={folder.length}
            leading={
              <RefreshButton
                label="자료 새로고침"
                disabled={!w.ready}
                refreshing={refreshing}
                onRefresh={refresh}
              />
            }
            selection={{
              active: selecting,
              selectedCount: selected.length,
              allLabel: "표시된 파일 전체 선택",
              allChecked,
              someChecked: folder.some((file) => selectedSet.has(file.id)),
              allDisabled: !w.ready || !folder.length,
              onAll: (checked) =>
                w.setSelectedFiles((ids) =>
                  checked
                    ? [...new Set([...ids, ...folder.map((file) => file.id)])]
                    : ids.filter((id) => !folder.some((file) => file.id === id))
                ),
              onDone: done,
              startLabel: "파일 선택 모드",
              startDisabled: !w.ready || !folder.length,
              onStart: () => setSelecting(true),
            }}
          />
        </SidebarHeader>
        <SidebarContent
          className="scroll-fade scroll-fade-4"
          aria-busy={(!w.ready && !w.loadError) || refreshing}
        >
          {w.loadError ? (
            <NoFiles>자료를 불러오지 못했습니다.</NoFiles>
          ) : !w.ready || refreshing ? (
            <ListSkeleton />
          ) : (
            <SidebarGroup>
              {folder.length ? (
                fileList(folder, "folder")
              ) : (
                <NoFiles>
                  {narrowed
                    ? "조건에 맞는 폴더 파일이 없습니다."
                    : "이 폴더에 FITS 파일이 없습니다."}
                </NoFiles>
              )}
            </SidebarGroup>
          )}
        </SidebarContent>
        {selecting && (
          <SidebarFooter>
            <div
              className="flex min-h-9 flex-wrap items-center justify-end gap-4"
              role="group"
              aria-label="선택한 파일 작업"
            >
              <Button
                className="min-w-0 flex-1"
                disabled={!selected.length}
                onClick={() => w.setAddOpen(true)}
              >
                작업에 사용
              </Button>
              <DeleteSelectionButton
                ids={selected}
                label="선택한 파일 삭제"
                description="휴지통에서 복원할 수 있습니다."
                onDelete={async (ids) => {
                  await w.deleteLibrary("files", ids)
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
