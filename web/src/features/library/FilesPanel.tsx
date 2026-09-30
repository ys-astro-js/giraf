import { useMemo, useState } from "react"
import { SidebarContent, SidebarGroup } from "@/components/ui/sidebar"
import { ToolbarGroup, ToolbarSpacer } from "@/components/toolbar"
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
import { ListBars, ListSkeleton, NoFiles, RefreshButton } from "./shared"
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
        <ListBars
          title="파일"
          count={folder.length}
          tools={
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
          search={
            <>
              <SearchField
                variant="glass"
                label="파일명 검색"
                value={query}
                onValueChange={(value) => {
                  setQuery(value)
                  resetLimits()
                }}
              />
              <ToolbarSpacer />
              <ToolbarGroup label="필터">
                <FileFilterButton
                  inToolbar
                  filters={filters}
                  bands={bands}
                  onChange={(next) => {
                    setFilters(next)
                    resetLimits()
                  }}
                />
              </ToolbarGroup>
            </>
          }
          selectionActions={
            <>
              <Button
                className="min-w-0 flex-1"
                disabled={!selected.length}
                onClick={() => w.setAddOpen(true)}
              >
                작업에 사용
              </Button>
              <ToolbarSpacer />
              <DeleteSelectionButton
                ids={selected}
                label="선택한 파일 삭제"
                description="휴지통에서 복원할 수 있습니다."
                onDelete={async (ids) => {
                  await w.deleteLibrary("files", ids)
                  done()
                }}
              />
            </>
          }
        />
        <SidebarContent
          data-window-scroll
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
      </div>
    </TooltipProvider>
  )
}
