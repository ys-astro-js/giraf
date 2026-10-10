import { useRef, useState, type ReactNode } from "react"
import { RESULTS, useFilePicker } from "./useFilePicker"
import { PickerList, PickerRow } from "./PickerList"
import { TrashDialog } from "@/components/delete-selection-button"
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Ellipsis,
  Eye,
  FileImage,
  FileText,
  FolderOpen,
  History,
  Trash2,
  X,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { FileFilterButton } from "@/components/file-filter-button"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { SearchField } from "@/components/search-field"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
  ToolbarSpacer,
} from "@/components/toolbar"
import {
  actionTargets,
  addInputs,
  emptyHighlight,
  keepListed,
  pathCrumbs,
  removeInputs,
  reorder,
  type RunGroup,
} from "@/lib/file-picker"
import { type Frame, type Job, type Slot, type Workspace } from "@/lib/workbench"
import { Blank, Failure } from "@/components/workbench-controls"
import "@/styles/library/file-picker.css"

export type PickerRequest = {
  slot: Slot
  initial: string[]
  apply: (ids: string[]) => void
  /** The dialog's title: the node and its input (`dark › 파일`). */
  title?: string
  folderOnly?: boolean
  applyFolder?: (path: string) => void
  /** Folder to open first; the working folder by default. */
  startPath?: string
  folderAction?: string
}

const isText = (file: Frame) =>
  ["text", "image-list"].includes(file.asset || "")
const canPreview = (file: Frame) => file.asset === "image" || isText(file)
const FileIcon = ({ file }: { file: Frame }) =>
  isText(file) ? <FileText /> : <FileImage />

/** A row's action, shown while the row is hovered or focused. */
function RowAction({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <ToolbarButton
      label={label}
      variant="outline"
      tabIndex={-1}
      className="picker-row-action size-7"
      onClick={onClick}
    >
      {children}
    </ToolbarButton>
  )
}

export function FilePicker({
  request,
  workspace,
  rows,
  jobs,
  remember,
  onClose,
  onDelete,
}: {
  request: PickerRequest
  workspace: Workspace
  rows: Frame[]
  jobs: Job[]
  remember: (rows: Frame[]) => void
  onClose: () => void
  onDelete: (ids: string[]) => Promise<void>
}) {
  const p = useFilePicker({ workspace, request, remember, rows, jobs })
  const folderOnly = !!request.folderOnly
  const multiple = !!request.slot.multiple
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [trash, setTrash] = useState<string[] | null>(null)
  const leftList = useRef<HTMLDivElement>(null)
  const rightList = useRef<HTMLDivElement>(null)
  // Where the focus goes back to when the preview closes.
  const [previewFrom, setPreviewFrom] = useState<"left" | "right">("left")
  const chosen = new Set(p.chosen)

  // Rows of the left list, top to bottom.
  type Item =
    | { kind: "folder"; key: string; name: string; path: string }
    | { kind: "file"; key: string; file: Frame; depth?: number }
    | { kind: "run"; key: string; group: RunGroup; open: boolean; depth: number }
    | { kind: "older"; key: string; count: number; open: boolean }
  const items: Item[] = []
  if (p.results) {
    // Earlier runs sit one step in under their row, and start folded.
    const runItems = (group: RunGroup, depth: number) => {
      const key = "run:" + group.id
      const shown = open[key] ?? depth === 0
      items.push({ kind: "run", key, group, open: shown, depth })
      if (shown)
        for (const file of group.files)
          items.push({ kind: "file", key: file.id, file, depth: depth + 1 })
    }
    p.runs.recent.forEach((group) => runItems(group, 0))
    if (p.runs.older.length) {
      const shown = !!open.older
      items.push({
        kind: "older",
        key: "older",
        count: p.runs.older.length,
        open: shown,
      })
      if (shown) p.runs.older.forEach((group) => runItems(group, 1))
    }
  } else if (!p.busy && !p.error) {
    for (const d of p.directories)
      items.push({ kind: "folder", key: "dir:" + d.path, ...d })
    for (const file of p.files) items.push({ kind: "file", key: file.id, file })
  }
  const order = items
    .filter((item) => !(folderOnly && item.kind === "file"))
    .map((item) => item.key)
  const fileKeys = new Set(
    items.filter((item) => item.kind === "file").map((item) => item.key)
  )
  const left = keepListed(p.left, order)
  const highlightedFiles = left.selected.filter((key) => fileKeys.has(key))
  const right = keepListed(p.right, p.chosen)

  function add(ids: string[]) {
    p.setChosen((current) => addInputs(current, ids, multiple))
  }
  function remove(ids: string[]) {
    p.setChosen((current) => removeInputs(current, ids))
  }
  /** What a row's add button adds: the row, or every highlighted file with it. */
  function addTargets(id: string) {
    return actionTargets(left, order, id).filter(
      (key) => fileKeys.has(key) && !chosen.has(key)
    )
  }
  function enter(path: string) {
    setEditing(false)
    p.navigate(path)
  }
  function preview(file: Frame, from: "left" | "right" = "left") {
    if (!canPreview(file)) return
    setPreviewFrom(from)
    p.setPreview(file)
  }

  const title = folderOnly
    ? "폴더 선택"
    : request.title || request.slot.label || request.slot.name
  const crumbs = p.results
    ? [{ name: "실행 결과", path: RESULTS }]
    : pathCrumbs(p.busy || !p.data ? p.path : p.data.path)
  const empty = p.query
    ? "검색 결과 없음"
    : p.hasFilters && !folderOnly
      ? "필터에 맞는 파일 없음"
      : p.results
        ? "실행 결과 없음"
        : "빈 폴더"

  function fileRow(file: Frame, depth = 0) {
    const ready = chosen.has(file.id)
    const targets = ready ? [] : addTargets(file.id)
    const name = (
      <span className="picker-cell picker-name" data-depth={depth || undefined}>
        <FileIcon file={file} />
        <span className="picker-filename" title={file.label}>
          {file.label}
        </span>
      </span>
    )
    const details = (
      <>
        <span className="picker-cell">{file.filter || "—"}</span>
        <span className="picker-cell picker-number">
          {isText(file) ? "—" : (file.exposure ?? "—")}
        </span>
      </>
    )
    if (folderOnly)
      return (
        <div key={file.id} className="picker-row" data-inert>
          {name}
          {details}
          <span />
        </div>
      )
    return (
      <PickerRow
        key={file.id}
        id={file.id}
        onActivate={() => add(targets.length ? targets : [])}
      >
        {name}
        {details}
        <span className="picker-cell picker-actions">
          {canPreview(file) && (
            <RowAction
              label={`${file.label} 미리보기`}
              onClick={() => preview(file)}
            >
              <Eye />
            </RowAction>
          )}
          {ready ? (
            <Check
              className="picker-in-input"
              role="img"
              aria-label="입력에 있음"
            />
          ) : (
            <RowAction
              label={
                targets.length > 1
                  ? `선택한 ${targets.length}개 입력에 추가`
                  : `${file.label} 입력에 추가`
              }
              onClick={() => add(targets)}
            >
              <ArrowRight />
            </RowAction>
          )}
        </span>
      </PickerRow>
    )
  }

  function toggle(key: string, shown: boolean) {
    setOpen((current) => ({ ...current, [key]: !shown }))
  }

  const leftBody = p.error ? (
    <div className="picker-pane-state">
      <Failure message={p.error} />
    </div>
  ) : p.busy ? (
    <div className="picker-pane-state flex flex-col gap-2">
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
      <Skeleton className="h-8 w-full" />
    </div>
  ) : !items.length ? (
    <Blank>{empty}</Blank>
  ) : (
    items.map((item) => {
      if (item.kind === "file") return fileRow(item.file, item.depth)
      if (item.kind === "folder")
        return (
          <PickerRow
            key={item.key}
            id={item.key}
            onActivate={() => enter(item.path)}
          >
            <span className="picker-cell picker-name picker-span">
              <FolderOpen />
              <span className="picker-filename">{item.name}</span>
            </span>
          </PickerRow>
        )
      const Chevron = item.open ? ChevronDown : ChevronRight
      return (
        <PickerRow
          key={item.key}
          id={item.key}
          className="picker-run"
          aria-expanded={item.open}
          onActivate={() => toggle(item.key, item.open)}
          onClick={(event) => {
            if (!event.shiftKey && !event.metaKey && !event.ctrlKey)
              toggle(item.key, item.open)
          }}
        >
          <span
            className="picker-cell picker-name picker-span"
            data-depth={(item.kind === "run" && item.depth) || undefined}
          >
            <Chevron className="picker-chevron" />
            {item.kind === "run" ? (
              <>
                <span className="picker-run-node">{item.group.title}</span>
                <span className="picker-muted">{item.group.task}</span>
                <span className="picker-run-time">{item.group.time}</span>
              </>
            ) : (
              <span className="picker-muted">{`이전 실행 ${item.count}개`}</span>
            )}
          </span>
        </PickerRow>
      )
    })
  )

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <DialogContent
        className="file-picker-dialog"
        aria-describedby={undefined}
        showCloseButton={false}
        initialFocus={leftList}
        onKeyDown={(event) => {
          const target = event.target as HTMLElement
          if (target.closest("input, textarea")) return
          if (
            ((event.metaKey || event.ctrlKey) && event.code === "KeyL") ||
            ((event.code === "Slash" || event.key === "/") &&
              !event.metaKey &&
              !event.ctrlKey)
          ) {
            if (p.results) return
            event.preventDefault()
            setDraft(p.path)
            setEditing(true)
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="picker-toolbar">
          <ToolbarCluster edge="start">
            <ToolbarGroup label="이동">
              <ToolbarButton label="뒤로" disabled={!p.back} onClick={p.back}>
                <ChevronLeft />
              </ToolbarButton>
              <ToolbarButton
                label="앞으로"
                disabled={!p.forward}
                onClick={p.forward}
              >
                <ChevronRight />
              </ToolbarButton>
              <ToolbarButton
                label="상위 폴더"
                disabled={p.results || p.path === "/"}
                onClick={() =>
                  enter(
                    !p.busy && p.data
                      ? p.data.parent
                      : (pathCrumbs(p.path).at(-2)?.path ?? "/")
                  )
                }
              >
                <ArrowUp />
              </ToolbarButton>
            </ToolbarGroup>
          </ToolbarCluster>
          {editing ? (
            <Input
              autoFocus
              aria-label="폴더 경로"
              className="picker-path-input"
              value={draft}
              onFocus={(event) => event.currentTarget.select()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return
                if (event.key === "Enter") {
                  event.preventDefault()
                  if (draft.trim()) enter(draft.trim())
                } else if (event.key === "Escape") {
                  event.preventDefault()
                  event.stopPropagation()
                  setEditing(false)
                }
              }}
            />
          ) : (
            <nav
              aria-label="폴더 경로"
              className="toolbar-group picker-path"
              onClick={(event) => {
                if (p.results || (event.target as HTMLElement).closest("button"))
                  return
                setDraft(p.path)
                setEditing(true)
              }}
            >
              <ol className="picker-crumbs">
                {crumbs.map((crumb, i) => (
                  <li key={crumb.path}>
                    {i > 0 && (
                      <ChevronRight
                        aria-hidden="true"
                        className="picker-crumb-separator"
                      />
                    )}
                    {i === crumbs.length - 1 ? (
                      <span className="picker-crumb-current" aria-current="page">
                        {crumb.name}
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        className="picker-crumb"
                        onClick={() => enter(crumb.path)}
                      >
                        {crumb.name}
                      </Button>
                    )}
                  </li>
                ))}
              </ol>
              <span className="picker-path-filler" />
            </nav>
          )}
          <ToolbarCluster edge="end">
            {!folderOnly && (
              <>
                <ToolbarGroup label="더 보기">
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<ToolbarButton label="더 보기" />}
                    >
                      <Ellipsis />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuGroup>
                        <DropdownMenuItem
                          variant="destructive"
                          disabled={!highlightedFiles.length}
                          onClick={() => setTrash(highlightedFiles)}
                        >
                          <Trash2 />
                          휴지통으로 이동
                        </DropdownMenuItem>
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </ToolbarGroup>
                <ToolbarSpacer />
              </>
            )}
            <SearchField
              variant="glass"
              className="picker-search"
              label={folderOnly ? "폴더 검색" : "파일 검색"}
              value={p.query}
              onValueChange={p.setQuery}
            />
            {!folderOnly && (
              <>
                <ToolbarSpacer />
                <ToolbarGroup label="필터">
                  <FileFilterButton
                    inToolbar
                    filters={p.filters}
                    bands={p.bands}
                    onChange={p.setFilters}
                  />
                </ToolbarGroup>
              </>
            )}
          </ToolbarCluster>
        </div>
        <div className="picker-body">
          <aside className="picker-shortcuts" aria-label="위치">
            {p.shortcuts.map((s) => (
              <Button
                key={s.path}
                variant="ghost"
                className="justify-start"
                data-active={(!p.results && p.path === s.path) || undefined}
                onClick={() => enter(s.path)}
              >
                <FolderOpen data-icon="inline-start" />
                {s.name}
              </Button>
            ))}
            {!folderOnly && (
              <>
                <Separator className="my-1" />
                <Button
                  variant="ghost"
                  className="justify-start"
                  data-active={p.results || undefined}
                  onClick={() => enter(RESULTS)}
                >
                  <History data-icon="inline-start" />
                  실행 결과
                </Button>
              </>
            )}
          </aside>
          <section className="picker-pane picker-files">
            <PickerList
              label={p.results ? "실행 결과" : "파일 목록"}
              listRef={leftList}
              order={order}
              highlight={left}
              onHighlight={p.setLeft}
              onKey={(event) => {
                if (event.key !== " " || !left.focus) return
                const file = p.lookup.get(left.focus)
                if (!file || !fileKeys.has(left.focus) || !canPreview(file)) return
                event.preventDefault()
                preview(file)
                return true
              }}
              header={
                <div className="picker-row picker-head" aria-hidden="true">
                  <span className="picker-cell">이름</span>
                  {!(folderOnly && !p.files.length) && (
                    <>
                      <span className="picker-cell">필터</span>
                      <span className="picker-cell">
                        노출 시간 <span className="picker-muted">초</span>
                      </span>
                      <span />
                    </>
                  )}
                </div>
              }
            >
              {leftBody}
            </PickerList>
          </section>
          {!folderOnly && (
            <section className="picker-pane picker-chosen">
              <PickerList
                label="입력 순서"
                listRef={rightList}
                order={p.chosen}
                highlight={right}
                onHighlight={p.setRight}
                onKey={(event) => {
                  if (event.key === " " && right.focus) {
                    const file = p.lookup.get(right.focus)
                    if (file && canPreview(file)) {
                      event.preventDefault()
                      preview(file, "right")
                      return true
                    }
                  }
                  if (
                    (event.key === "Delete" || event.key === "Backspace") &&
                    right.selected.length
                  ) {
                    event.preventDefault()
                    const at = p.chosen.indexOf(right.focus ?? "")
                    const rest = removeInputs(p.chosen, right.selected)
                    remove(right.selected)
                    const next = rest[Math.min(at, rest.length - 1)]
                    p.setRight(
                      next
                        ? { selected: [next], anchor: next, focus: next }
                        : emptyHighlight
                    )
                    return true
                  }
                }}
                header={
                  <div className="picker-row picker-head">
                    <span className="picker-cell picker-span">입력 순서</span>
                    <span className="picker-cell picker-reorder">
                      <ToolbarButton
                        label="위로"
                        className="size-7"
                        disabled={!right.selected.length || !multiple}
                        onClick={() =>
                          p.setChosen((list) => reorder(list, right.selected, -1))
                        }
                      >
                        <ArrowUp />
                      </ToolbarButton>
                      <ToolbarButton
                        label="아래로"
                        className="size-7"
                        disabled={!right.selected.length || !multiple}
                        onClick={() =>
                          p.setChosen((list) => reorder(list, right.selected, 1))
                        }
                      >
                        <ArrowDown />
                      </ToolbarButton>
                    </span>
                  </div>
                }
              >
                {!p.chosen.length ? (
                  <p className="picker-pane-empty">비어 있음</p>
                ) : (
                  p.chosen.map((id, i) => {
                    const file = p.lookup.get(id)
                    const label = file?.label ?? id
                    const targets = actionTargets(right, p.chosen, id)
                    const origin = p.origin(file)
                    return (
                      <PickerRow
                        key={id}
                        id={id}
                        onActivate={() => remove(targets)}
                      >
                        <span className="picker-cell picker-number picker-muted">
                          {i + 1}
                        </span>
                        <span className="picker-cell picker-chosen-name">
                          <span className="picker-filename" title={label}>
                            {label}
                          </span>
                          {origin && (
                            <span className="picker-origin">{origin}</span>
                          )}
                        </span>
                        <span className="picker-cell picker-actions">
                          {file && canPreview(file) && (
                            <RowAction
                              label={`${label} 미리보기`}
                              onClick={() => preview(file, "right")}
                            >
                              <Eye />
                            </RowAction>
                          )}
                          <RowAction
                            label={
                              targets.length > 1
                                ? `선택한 ${targets.length}개 입력에서 빼기`
                                : `${label} 입력에서 빼기`
                            }
                            onClick={() => remove(targets)}
                          >
                            <ArrowLeft />
                          </RowAction>
                        </span>
                      </PickerRow>
                    )
                  })
                )}
              </PickerList>
            </section>
          )}
        </div>
        <div className="picker-footer">
          {!folderOnly && (
            <span className="text-sm text-muted-foreground" role="status">
              {p.chosen.length}개 선택됨
            </span>
          )}
          <ToolbarCluster edge="end">
            <ToolbarGroup label="취소">
              <ToolbarButton label="취소" onClick={onClose}>
                <X />
              </ToolbarButton>
            </ToolbarGroup>
            <ToolbarGroup label="확인">
              <ToolbarButton
                prominent
                label={
                  folderOnly ? request.folderAction || "이 폴더 열기" : "확인"
                }
                disabled={folderOnly ? !p.data || p.busy : !p.chosen.length}
                onClick={() => {
                  if (folderOnly) request.applyFolder?.(p.data!.path)
                  else request.apply(p.chosen)
                  onClose()
                }}
              >
                <Check />
              </ToolbarButton>
            </ToolbarGroup>
          </ToolbarCluster>
        </div>
        <TrashDialog
          targets={trash}
          description="휴지통에서 복원할 수 있습니다."
          onClose={() => setTrash(null)}
          onDelete={async (ids) => {
            await onDelete(ids)
            remove(ids)
            p.setLeft(emptyHighlight)
            if (p.preview && ids.includes(p.preview.id)) p.setPreview(null)
            p.reload()
          }}
        />
        <Dialog
          open={!!p.preview}
          onOpenChange={(next) => {
            if (!next) p.setPreview(null)
          }}
        >
          <DialogContent
            finalFocus={previewFrom === "right" ? rightList : leftList}
            className="max-h-[85dvh] overflow-auto sm:max-w-xl"
            aria-describedby={undefined}
          >
            <DialogHeader className="pr-8">
              <DialogTitle className="break-all">{p.preview?.label}</DialogTitle>
            </DialogHeader>
            {p.preview?.asset === "image" ? (
              <img
                src={"/api/image?id=" + p.preview.id}
                alt={p.preview.label}
                className="max-h-[60dvh] w-full object-contain"
              />
            ) : (
              <pre className="break-all whitespace-pre-wrap">{p.text}</pre>
            )}
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  )
}
