import { DeleteSelectionButton } from "@/components/delete-selection-button"
import { acceptsAsset } from "@/lib/workbench"
import { useEffect, useMemo, useRef, useState } from "react"
import { FolderOpen, FileImage, ArrowUp, Check, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { defaultFileFilters, filterFiles } from "@/lib/file-library"
import { FileFilterButton } from "@/components/file-filter-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { api, type Frame, type Slot, type Workspace } from "@/lib/workbench"
import { Blank, Failure } from "@/components/workbench-controls"

type Browse = {
  path: string
  parent: string
  breadcrumbs: { name: string; path: string }[]
  shortcuts: { name: string; path: string }[]
  directories: { name: string; path: string }[]
  files: Frame[]
}
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
  const [location, setLocation] = useState(workspace.folder)
  const [path, setPath] = useState(workspace.folder),
    [data, setData] = useState<Browse | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("")
  const [tab, setTab] = useState("folder"),
    [query, setQuery] = useState(""),
    [filters, setFilters] = useState(defaultFileFilters),
    [selection, setSelection] = useState(new Set(request.initial))
  const [preview, setPreview] = useState<Frame | null>(null),
    [text, setText] = useState("")
  const [browseAttempt, setBrowseAttempt] = useState(0)
  const last = useRef(""),
    rememberRef = useRef(remember)
  rememberRef.current = remember
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError("")
    api<Browse>("browse?path=" + encodeURIComponent(path))
      .then((next) => {
        if (cancelled) return
        setData(next)
        rememberRef.current(next.files)
        setBusy(false)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message)
          setBusy(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [path, browseAttempt])
  useEffect(() => {
    let cancelled = false
    setText("")
    if (preview && ["text", "image-list"].includes(preview.asset || ""))
      api<{ text: string }>("text?id=" + preview.id)
        .then((r) => {
          if (!cancelled) setText(r.text)
        })
        .catch((e) => {
          if (!cancelled) setError(e.message)
        })
    return () => {
      cancelled = true
    }
  }, [preview])
  const lookup = useMemo(
    () => new Map([...rows, ...(data?.files || [])].map((r) => [r.id, r])),
    [rows, data]
  )
  const list = useMemo(() => {
    const source =
      tab === "folder"
        ? data?.files || []
        : tab === "results"
          ? rows.filter((r) => r.job)
          : [...selection]
              .map((id) => lookup.get(id))
              .filter((r): r is Frame => !!r)
    return filterFiles(
      source.filter(
        (r) => acceptsAsset(request.slot.kind, r.asset) && !r.error
      ),
      query,
      filters
    )
  }, [tab, data, rows, selection, lookup, request.slot.kind, filters, query])
  const bands = [
    ...new Set(
      [...rows, ...(data?.files || [])]
        .map((file) => file.filter)
        .filter((band): band is string => !!band)
    ),
  ].sort()
  const hasFilters =
    filters.kind !== "all" ||
    filters.band !== "all" ||
    !!(filters.minExposure || filters.maxExposure)
  function select(id: string, checked: boolean, shift = false) {
    setSelection((current) => {
      const next = request.slot.multiple ? new Set(current) : new Set<string>()
      const a = list.findIndex((r) => r.id === last.current),
        b = list.findIndex((r) => r.id === id)
      const ids =
        shift && a >= 0 && request.slot.multiple
          ? list.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id)
          : [id]
      for (const id of ids) checked ? next.add(id) : next.delete(id)
      return next
    })
    last.current = id
  }
  function navigate(path: string) {
    setLocation(path)
    setPath(path)
    setQuery("")
    setTab("folder")
    setPreview(null)
  }
  const directories = tab === "folder" && !query ? data?.directories || [] : []
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
            <div className="picker-list" tabIndex={0} aria-label="파일 목록">
              {busy ? (
                <div className="flex flex-col gap-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      {!request.folderOnly && (
                        <TableHead className="w-10">
                          {request.slot.multiple ? (
                            <Checkbox
                              aria-label="표시된 파일 전체 선택"
                              checked={
                                list.length > 0 &&
                                list.every((r) => selection.has(r.id))
                              }
                              indeterminate={
                                list.some((r) => selection.has(r.id)) &&
                                !list.every((r) => selection.has(r.id))
                              }
                              disabled={!list.length}
                              onCheckedChange={(checked) =>
                                setSelection((s) => {
                                  const next = new Set(s)
                                  for (const r of list)
                                    checked ? next.add(r.id) : next.delete(r.id)
                                  return next
                                })
                              }
                            />
                          ) : (
                            <span className="sr-only">선택</span>
                          )}
                        </TableHead>
                      )}
                      <TableHead>이름</TableHead>
                      {!request.folderOnly && (
                        <>
                          <TableHead>필터</TableHead>
                          <TableHead>
                            <span className="flex items-baseline gap-2">
                              노출 시간{" "}
                              <span className="text-muted-foreground">초</span>
                            </span>
                          </TableHead>
                        </>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {directories.map((d) => (
                      <TableRow key={d.path}>
                        <TableCell colSpan={request.folderOnly ? 1 : 4}>
                          <Button
                            variant="ghost"
                            onClick={() => navigate(d.path)}
                          >
                            <FolderOpen data-icon="inline-start" />
                            <span className="picker-filename">{d.name}</span>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                    {!request.folderOnly &&
                      list.map((r) => (
                        <TableRow
                          key={r.id}
                          data-state={
                            selection.has(r.id) ? "selected" : undefined
                          }
                        >
                          <TableCell>
                            <Checkbox
                              aria-label={`${r.label} 선택`}
                              checked={selection.has(r.id)}
                              onCheckedChange={(checked, details) =>
                                select(
                                  r.id,
                                  checked,
                                  Boolean(
                                    (details.event as MouseEvent).shiftKey
                                  )
                                )
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              aria-label={`${r.label} 미리보기`}
                              onClick={() => setPreview(r)}
                            >
                              <FileImage data-icon="inline-start" />
                              <span className="picker-filename" title={r.label}>
                                {r.label}
                              </span>
                            </Button>
                          </TableCell>
                          <TableCell>{r.filter || "—"}</TableCell>
                          <TableCell>{r.exposure ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              )}
              {!busy && !list.length && !directories.length && (
                <Blank>
                  {query || hasFilters
                    ? query
                      ? "검색 결과 없음"
                      : "필터에 맞는 파일 없음"
                    : tab === "selection"
                      ? "선택한 파일 없음"
                      : tab === "results"
                        ? "실행 결과 없음"
                        : "빈 폴더"}
                </Blank>
              )}
            </div>
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
