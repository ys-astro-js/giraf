import { useFilePicker } from "./useFilePicker"
import { PickerFileList } from "./FileList"
import { DeleteSelectionButton } from "@/components/delete-selection-button"
import { FolderOpen, ArrowUp, Check, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { defaultFileFilters } from "@/lib/file-library"
import { FileFilterButton } from "@/components/file-filter-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { type Frame, type Slot, type Workspace } from "@/lib/workbench"
import { Failure } from "@/components/workbench-controls"

export type PickerRequest = {
  slot: Slot
  initial: string[]
  apply: (ids: string[]) => void
  folderOnly?: boolean
  applyFolder?: (path: string) => void
}
export function FilePicker({
  request,
  workspace,
  rows,
  remember,
  onClose,
  onDelete,
}: {
  request: PickerRequest
  workspace: Workspace
  rows: Frame[]
  remember: (rows: Frame[]) => void
  onClose: () => void
  onDelete: (ids: string[]) => Promise<void>
}) {
  const {
    error,
    setBrowseAttempt,
    navigate,
    location,
    busy,
    data,
    setLocation,
    tab,
    setTab,
    setQuery,
    setFilters,
    selection,
    query,
    filters,
    bands,
    list,
    setSelection,
    preview,
    setPreview,
    directories,
    select,
    hasFilters,
    text,
  } = useFilePicker({ workspace, request, remember, rows })
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        className="file-picker-dialog"
        aria-describedby={undefined}
      >
        <DialogHeader className="pr-8">
          <DialogTitle>
            {request.folderOnly ? "폴더 선택" : request.slot.label}
          </DialogTitle>
        </DialogHeader>
        {error && (
          <div className="flex items-center gap-2">
            <Failure message={error} />
            <Button
              variant="outline"
              onClick={() => setBrowseAttempt((v) => v + 1)}
            >
              다시 시도
            </Button>
          </div>
        )}
        <form
          className="flex shrink-0 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            navigate(location)
            setBrowseAttempt((v) => v + 1)
          }}
        >
          <Button
            variant="outline"
            size="icon"
            aria-label="상위 폴더"
            disabled={busy || !data || data.path === data.parent}
            onClick={() => navigate(data!.parent)}
          >
            <ArrowUp />
          </Button>
          <Field className="min-w-0">
            <FieldLabel className="sr-only" htmlFor="picker-path">
              폴더 경로
            </FieldLabel>
            <Input
              id="picker-path"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </Field>
          <Button type="submit" variant="outline">
            이동
          </Button>
        </form>
        <div className="picker-body">
          <aside className="picker-shortcuts">
            {data?.shortcuts.map((s) => (
              <Button
                key={s.path}
                variant="ghost"
                className="justify-start"
                onClick={() => navigate(s.path)}
              >
                <FolderOpen data-icon="inline-start" />
                {s.name}
              </Button>
            ))}
          </aside>
          <div className="picker-main">
            {!request.folderOnly && (
              <>
                <Tabs
                  value={tab}
                  onValueChange={(v) => {
                    setTab(String(v))
                    setQuery("")
                    setFilters(defaultFileFilters)
                  }}
                >
                  <TabsList>
                    <TabsTrigger value="folder">폴더</TabsTrigger>
                    <TabsTrigger value="results">실행 결과</TabsTrigger>
                    <TabsTrigger value="selection">
                      {`선택됨 ${selection.size}개`}
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <FieldGroup className="picker-filters items-end">
                  <Field className="min-w-0">
                    <FieldLabel htmlFor="picker-search">파일 검색</FieldLabel>
                    <Input
                      id="picker-search"
                      placeholder="파일명 검색"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </Field>
                  {query && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="검색 초기화"
                      onClick={() => setQuery("")}
                    >
                      <X />
                    </Button>
                  )}
                  {request.slot.kind === "image" && (
                    <FileFilterButton
                      filters={filters}
                      bands={bands}
                      onChange={setFilters}
                    />
                  )}
                </FieldGroup>
              </>
            )}
            {!request.folderOnly && (
              <div
                className="flex flex-wrap items-center justify-between gap-4"
                role="group"
                aria-label="파일 선택 관리"
              >
                <div className="flex items-center gap-3">
                  {request.slot.multiple && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy || !list.length}
                      onClick={() =>
                        setSelection(
                          (current) =>
                            new Set([
                              ...current,
                              ...list.map((file) => file.id),
                            ])
                        )
                      }
                    >
                      전체 선택
                    </Button>
                  )}
                  <span className="text-sm text-muted-foreground" role="status">
                    {selection.size}개 선택
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!selection.size}
                    onClick={() => setSelection(new Set())}
                  >
                    선택 해제
                  </Button>
                  <DeleteSelectionButton
                    ids={[...selection]}
                    label="선택한 파일 삭제"
                    disabled={busy}
                    description="휴지통에서 복원할 수 있습니다."
                    onDelete={async (ids) => {
                      await onDelete(ids)
                      setSelection(
                        (current) =>
                          new Set(
                            [...current].filter((id) => !ids.includes(id))
                          )
                      )
                      if (preview && ids.includes(preview.id)) setPreview(null)
                      setBrowseAttempt((value) => value + 1)
                    }}
                  />
                </div>
              </div>
            )}
            <PickerFileList
              busy={busy}
              request={request}
              list={list}
              selection={selection}
              setSelection={setSelection}
              directories={directories}
              navigate={navigate}
              select={select}
              setPreview={setPreview}
              query={query}
              hasFilters={hasFilters}
              tab={tab}
            />
          </div>
        </div>
        <DialogFooter className="picker-footer">
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={
              busy ||
              (request.folderOnly
                ? !data
                : !!request.slot.required && !selection.size)
            }
            onClick={() => {
              if (request.folderOnly) request.applyFolder?.(data!.path)
              else request.apply([...selection])
              onClose()
            }}
          >
            <Check data-icon="inline-start" />
            {request.folderOnly ? (
              "이 폴더 열기"
            ) : (
              <>{`${selection.size}개 선택`}</>
            )}
          </Button>
        </DialogFooter>
        <Dialog
          open={!!preview}
          onOpenChange={(open) => {
            if (!open) setPreview(null)
          }}
        >
          <DialogContent
            className="max-h-[85dvh] overflow-auto sm:max-w-xl"
            aria-describedby={undefined}
          >
            <DialogHeader className="pr-8">
              <DialogTitle className="break-all">{preview?.label}</DialogTitle>
            </DialogHeader>
            {preview?.asset === "image" ? (
              <img
                src={"/api/image?id=" + preview.id}
                alt={preview.label}
                className="max-h-[60dvh] w-full object-contain"
              />
            ) : (
              <pre className="break-all whitespace-pre-wrap">{text}</pre>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setPreview(null)}>
                <X data-icon="inline-start" />
                닫기
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
