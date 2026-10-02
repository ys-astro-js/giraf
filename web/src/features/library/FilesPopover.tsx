import { useMemo, useRef, useState } from "react"
import { Images } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { SearchField } from "@/components/search-field"
import { FileFilterButton } from "@/components/file-filter-button"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import {
  defaultFileFilters,
  filterFiles,
  partitionFiles,
  type FileFilters,
} from "@/lib/file-library"
import { useWorkbench } from "@/features/workbench/context"
import { FileTable } from "@/features/file-picker/FileList"
import { RefreshButton } from "./shared"
import { useRefresh } from "./useRefresh"
import "@/styles/library/popovers.css"

type Source = "folder" | "products"

/**
 * The toolbar's way to open a file in a viewer: the working folder's files
 * or what runs produced, searched and filtered like the input picker's.
 */
export function FilesButton() {
  const w = useWorkbench()
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState<Source>("folder")
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<FileFilters>(defaultFileFilters)
  const { refreshing, refresh } = useRefresh(w.refresh, w.setError)
  const search = useRef<HTMLInputElement>(null)
  const files = useMemo(
    () => ({
      folder: partitionFiles(w.workspace.files).folder,
      products: w.jobs.flatMap((job) => job.products),
    }),
    [w.workspace.files, w.jobs]
  )
  const list = filterFiles(files[source], query, filters)
  const bands = [
    ...new Set(
      files[source]
        .map((file) => file.filter)
        .filter((band): band is string => !!band)
    ),
  ].sort()
  const narrowed =
    !!query.trim() ||
    filters.kind !== "all" ||
    filters.band !== "all" ||
    !!(filters.minExposure || filters.maxExposure)
  return (
    <ToolbarGroup label="파일">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<ToolbarButton label="파일 열기" />}>
          <Images />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          sideOffset={8}
          className="library-popover library-popover-wide"
          initialFocus={search}
        >
          <PopoverTitle className="sr-only">파일 열기</PopoverTitle>
          <Tabs
            value={source}
            onValueChange={(value) => {
              setSource(value as Source)
              setFilters(defaultFileFilters)
            }}
          >
            <TabsList className="w-full">
              <TabsTrigger value="folder">폴더</TabsTrigger>
              <TabsTrigger value="products">실행 산출물</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="library-popover-bar">
            <SearchField
              inputRef={search}
              label="파일명 검색"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                if (event.key === "Enter" && list[0]) {
                  w.assetViewer.open(list[0])
                  setOpen(false)
                }
              }}
            />
            <FileFilterButton
              filters={filters}
              bands={bands}
              onChange={setFilters}
            />
            <RefreshButton
              label="자료 새로고침"
              disabled={!w.ready}
              refreshing={refreshing}
              onRefresh={refresh}
            />
          </div>
          <div className="library-popover-list" aria-busy={refreshing}>
            <FileTable
              busy={(!w.ready && !w.loadError) || refreshing}
              list={list}
              onActivate={(file) => {
                w.assetViewer.open(file)
                setOpen(false)
              }}
              activateLabel={(file) => `${file.label} 뷰어에서 열기`}
              empty={
                w.loadError
                  ? "자료를 불러오지 못했습니다."
                  : narrowed
                    ? "조건에 맞는 파일이 없습니다."
                    : source === "folder"
                      ? "이 폴더에 FITS 파일이 없습니다."
                      : "실행 산출물이 없습니다."
              }
            />
          </div>
        </PopoverContent>
      </Popover>
    </ToolbarGroup>
  )
}
