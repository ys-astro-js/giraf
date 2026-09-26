import { useRef, useState } from "react"
import { Check, Copy, Download, Ellipsis, FolderOpen, Plus, Search, TextCursorInput, Trash2, Upload, Workflow, X } from "lucide-react"
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { Checkbox } from "@/components/ui/checkbox"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group"
import { Empty, EmptyDescription, EmptyHeader } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { Separator } from "@/components/ui/separator"
import { WorkflowToolButton } from "@/components/workflow-tools"
import { StatusTransition } from "@/components/status-transition"
import { api, type WorkflowDocument } from "@/lib/workbench"

type Item = WorkflowDocument & { folder: string }
export type WorkflowAction = { operation: "open"; path: string } | { operation: "new" } | { operation: "duplicate"; paths?: string[] } | { operation: "import"; document: unknown } | { operation: "delete"; paths: string[] }
type Props = {
  document?: WorkflowDocument
  disabled: boolean
  onSave: (name?: string) => Promise<void>
  onChange: (action: WorkflowAction) => Promise<void>
  onExport: () => void
}

export function WorkflowSelector(props: Props) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [query, setQuery] = useState("")
  const [name, setName] = useState("")
  const [editing, setEditing] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [deleting, setDeleting] = useState<Item[] | null>(null)
  const file = useRef<HTMLInputElement>(null)
  const search = useRef<HTMLInputElement>(null)
  async function reload() {
    setLoading(true)
    try { setItems(await api<Item[]>("workflow-documents")) }
    catch { setError("목록을 불러오지 못했습니다. 다시 열어 주세요.") }
    finally { setLoading(false) }
  }
  async function perform(action: () => Promise<void>, close = false) {
    setBusy(true)
    setError("")
    try {
      await action()
      setSelecting(false)
      setSelected([])
      if (close) setOpen(false)
      else await reload()
    } catch { setError("변경하지 못했습니다. 파일과 폴더 권한을 확인하고 다시 시도해 주세요.") }
    finally { setBusy(false) }
  }
  const available = props.document && !items.some(item => item.path === props.document?.path)
    ? [{...props.document, folder: "."}, ...items] : items
  const matches = available.filter(item => `${item.name} ${item.folder}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
  const groups = new Map<string, Item[]>()
  for (const item of matches) groups.set(item.folder, [...(groups.get(item.folder) || []), item])
  return <Popover open={open} onOpenChange={value => {
    if (busy || deleting) return
    setOpen(value)
    if (value) { setEditing(false); setSelecting(false); setSelected([]); setName(props.document?.name || "새 워크플로우"); setQuery(""); setError(""); void reload() }
  }}>
    <PopoverTrigger render={<Button variant="ghost" size="xs" className="min-w-0 text-sm" disabled={props.disabled} />}
      aria-label={`워크플로우 선택: ${props.document?.name || "새 워크플로우"}`} title={props.document?.name}>
      <Workflow data-icon="inline-start" className="size-4" /><span className="truncate">{props.document?.name || "새 워크플로우"}</span>
    </PopoverTrigger>
    <PopoverContent className="w-80 max-w-[calc(100vw-24px)] max-h-[min(32rem,var(--available-height))] gap-0 overflow-hidden rounded-xl p-0" sideOffset={8} initialFocus={search}>
      <PopoverTitle className="sr-only">워크플로우</PopoverTitle>
      <div className="flex shrink-0 items-center gap-2 p-3" aria-label="현재 워크플로우">
        <Workflow className="size-4 shrink-0" aria-hidden="true" />
        {editing ? <form className="flex min-w-0 flex-1 items-center gap-1" onSubmit={event => {
                event.preventDefault()
                if (name.trim()) void perform(async () => { await props.onSave(name.trim()); setEditing(false) })
              }}>
                <Field className="min-w-0 flex-1">
                  <FieldLabel htmlFor="workflow-name" className="sr-only">워크플로우 이름</FieldLabel>
                  <Input id="workflow-name" autoFocus value={name} maxLength={120} disabled={busy} onChange={event => setName(event.target.value)} onKeyDown={event => {
                    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setEditing(false) }
                  }} />
                </Field>
                <WorkflowToolButton type="submit" size="icon-sm" variant="ghost" label="이름 변경 저장" disabled={busy || !name.trim()}><Check /></WorkflowToolButton>
                <WorkflowToolButton type="button" size="icon-sm" variant="ghost" label="이름 변경 취소" disabled={busy} onClick={() => setEditing(false)}><X /></WorkflowToolButton>
              </form> : <>
          <span className="min-w-0 flex-1 break-words font-medium">{props.document?.name || "새 워크플로우"}</span>
          <div className="flex shrink-0 items-center" aria-label="현재 워크플로우 도구">
            <div className="workflow-menu-transition" data-hidden={selecting} inert={selecting} aria-hidden={selecting}>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" />} aria-label="워크플로우 메뉴" title="워크플로우 메뉴" disabled={busy}><Ellipsis /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="workflow-dropdown-transition">
                <DropdownMenuGroup>
                  <DropdownMenuItem onClick={() => { setName(props.document?.name || "새 워크플로우"); setEditing(true) }}><TextCursorInput />이름 변경</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void perform(() => props.onChange({ operation: "duplicate" }), true)}><Copy />복제</DropdownMenuItem>
                  <DropdownMenuItem onClick={props.onExport}><Download />내보내기</DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" disabled={!props.document} onClick={() => { setError(""); setDeleting([{ ...props.document!, folder: "." }]) }}><Trash2 />삭제</DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            </div>
            <Button variant="outline" size={selecting ? "icon-sm" : "sm"} className="workflow-selection-toggle" data-selecting={selecting} disabled={busy} aria-label={selecting ? "선택 취소" : "선택"} aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]) }}>
              <span className="workflow-selection-label" aria-hidden="true">선택</span>
              <X className="workflow-selection-close" aria-hidden="true" />
            </Button>
          </div>
        </>}
      </div>
      <Separator />
      <div className="shrink-0 p-2">
        <InputGroup>
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput ref={search} aria-label="워크플로우 검색" placeholder="워크플로우 검색" value={query} onChange={event => setQuery(event.target.value)} />
        </InputGroup>
      </div>
      <div className="min-h-0 overflow-y-auto px-2 pb-2" aria-label="사용 가능한 워크플로우">
        {loading ? <div className="flex flex-col gap-2 p-2" aria-label="워크플로우 목록 불러오는 중"><Skeleton className="h-8 w-full" /><Skeleton className="h-8 w-3/4" /></div> : matches.length ? [...groups].map(([folder, rows]) => <div key={folder} className="flex flex-col gap-1 not-first:pt-3">
          {(folder !== "." || groups.size > 1) && <p className="flex items-start gap-2 px-2 py-1 text-xs text-muted-foreground"><FolderOpen className="size-3.5 shrink-0" /><span className="break-all">{folder === "." ? "현재 폴더" : folder}</span></p>}
          {rows.map(item => {
            const current = item.path === props.document?.path
            if (selecting) return <label key={item.path} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm hover:bg-accent">
              <Checkbox checked={selected.includes(item.path)} disabled={busy} onCheckedChange={checked => setSelected(paths => checked ? [...paths, item.path] : paths.filter(path => path !== item.path))} />
              <span className="min-w-0 flex-1 break-all">{item.name}</span>
              {current && <Check className="size-4 shrink-0" aria-label="현재 워크플로우" />}
            </label>
            return <Button key={item.path} variant="ghost" className="h-auto min-h-9 min-w-0 justify-start rounded-lg whitespace-normal text-start" disabled={busy} aria-current={current ? "true" : undefined}
              onClick={() => current ? setOpen(false) : void perform(() => props.onChange({operation: "open", path: item.path}), true)}>
              <Check data-icon="inline-start" aria-hidden="true" style={{visibility: current ? "visible" : "hidden"}} /><span className="min-w-0 flex-1 break-all">{item.name}</span>
            </Button>
          })}
        </div>) : <Empty className="px-3 py-5"><EmptyHeader><EmptyDescription>{query ? "검색 결과가 없습니다." : "저장된 워크플로우가 없습니다."}</EmptyDescription></EmptyHeader></Empty>}
        {error && <p role="alert" className="px-2 py-2 text-sm text-destructive">{error}</p>}
      </div>
      <StatusTransition transitionKey={selecting ? "selection" : "add"} className="workflow-actions-transition shrink-0">
      <div className="flex items-center justify-between gap-2 p-2">
        {selecting ? <>
          <WorkflowToolButton variant="outline" size="icon-sm" tooltipSide="bottom" label="선택한 워크플로우 복제" disabled={busy || !selected.length} onClick={() => void perform(() => props.onChange({ operation: "duplicate", paths: selected }))}><Copy /></WorkflowToolButton>
          <span className="text-sm text-muted-foreground" role="status">{selected.length}개 선택</span>
          <WorkflowToolButton variant="destructive-outline" size="icon-sm" tooltipSide="bottom" label="선택한 워크플로우 삭제" disabled={busy || !selected.length} onClick={() => {
            setError("")
            setDeleting(available.filter(item => selected.includes(item.path)))
          }}><Trash2 /></WorkflowToolButton>
        </> : <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" />} aria-label="워크플로우 추가" title="워크플로우 추가" disabled={busy}><Plus /></DropdownMenuTrigger>
          <DropdownMenuContent side="top" className="workflow-dropdown-transition">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => void perform(() => props.onChange({operation: "new"}), true)}><Plus />새로 만들기</DropdownMenuItem>
              <DropdownMenuItem onClick={() => file.current?.click()}><Upload />불러오기</DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>}
      </div>
      </StatusTransition>
      <Dialog open={deleting !== null} onOpenChange={value => { if (!value && !busy) setDeleting(null) }}>
        <DialogContent showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>워크플로우 {deleting?.length}개를 삭제할까요?</DialogTitle>
            <DialogDescription>워크플로우 설정이 삭제됩니다. 입력 파일과 실행 결과는 보존됩니다.</DialogDescription>
          </DialogHeader>
          <ul className="max-h-48 list-disc overflow-y-auto pl-5 text-sm">{deleting?.map(item => <li key={item.path} className="break-all">{item.name}</li>)}</ul>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDeleting(null)}>취소</Button>
            <Button variant="destructive" disabled={busy} onClick={() => void perform(async () => {
              await props.onChange({ operation: "delete", paths: deleting!.map(item => item.path) })
              setSelected([])
              setDeleting(null)
            })}>{busy ? "삭제 중…" : "삭제"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <input ref={file} type="file" accept=".json,application/json" className="hidden" aria-label="워크플로우 파일" onChange={event => {
        const selected = event.target.files?.[0]
        event.target.value = ""
        if (selected) void perform(async () => {
          if (selected.size > 10 * 1024 * 1024) throw new Error("File too large")
          await props.onChange({operation: "import", document: JSON.parse(await selected.text())})
        }, true)
      }} />
    </PopoverContent>
  </Popover>
}
