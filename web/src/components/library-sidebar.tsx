import { taskPackageTree, type TaskPackage } from "@/lib/task-tree"
import {
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react"
import {
  ChevronRight,
  FileImage,
  FileText,
  Folder,
  RefreshCw,
  Search,
  X,
  Terminal,
} from "lucide-react"
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarInput,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { FieldDescription } from "@/components/ui/field"
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { CountBadge } from "@/components/count-badge"
import { FileFilterButton } from "@/components/file-filter-button"
import {
  defaultFileFilters,
  filterFiles,
  hiddenSelectionCount,
  partitionFiles,
  runLabel,
  toggleFileSelection,
  type FileFilters,
} from "@/lib/file-library"
import { taskDisplayName, type Catalog, type Frame, type Job, type Workspace } from "@/lib/workbench"

type Props = {
  workspace: Workspace
  catalog: Catalog | null
  jobs: Job[]
  ready: boolean
  loadError: boolean
  selected: string[]
  onSelect: Dispatch<SetStateAction<string[]>>
  onOpen: (file: Frame) => void
  onRefresh: () => Promise<unknown>
  onRefreshCatalog?: () => Promise<unknown>
  onError: (message: string) => void
  onAddTask: (name: string) => void
  onUse: () => void
  onSave: () => void
  children: ReactNode
}

function FileRow({
  file,
  selected,
  onSelect,
  onOpen,
}: Pick<Props, "onSelect" | "onOpen"> & { file: Frame; selected: boolean }) {
  const Icon = ["text", "image-list"].includes(file.asset || "") ? FileText : FileImage
  return (
    <SidebarMenuItem>
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={<SidebarMenuButton className="pr-10" isActive={selected} />}
          onClick={() => onOpen(file)}
          aria-label={`${file.label} 열기`}
        >
          <Icon />
          <span className="file-name" aria-hidden="true">
            <span>{file.label.slice(0, -18)}</span>
            <span>{file.label.slice(-18)}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent
          side="right"
          align="start"
          className="break-all data-open:animate-none data-closed:animate-none"
        >
          {file.label}
        </TooltipContent>
      </Tooltip>
      <Checkbox
        className="absolute top-2 right-3"
        aria-label={`${file.label} 선택`}
        checked={selected}
        onCheckedChange={(checked) =>
          onSelect((ids) => toggleFileSelection(ids, file.id, checked))
        }
      />
    </SidebarMenuItem>
  )
}

function SourceGroup({
  label,
  count,
  open,
  onOpenChange,
  children,
}: {
  label: string
  count: number
  open: boolean
  onOpenChange: (open: boolean) => void
  children: ReactNode
}) {
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="group/source"
    >
      <SidebarGroup>
        <SidebarGroupLabel render={<CollapsibleTrigger />} className="gap-2">
          <ChevronRight className="transition-transform group-data-open/source:rotate-90" />
          <span>{label}</span>
          <span className="ml-auto tabular-nums text-muted-foreground">{count}</span>
        </SidebarGroupLabel>
        <CollapsibleContent>
          <SidebarGroupContent>{children}</SidebarGroupContent>
        </CollapsibleContent>
      </SidebarGroup>
    </Collapsible>
  )
}

function NoFiles({ children }: { children: ReactNode }) {
  return (
    <Empty className="px-3 py-4">
      <EmptyHeader>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function LibrarySidebar(props: Props) {
  const { workspace, selected, onSelect } = props
  const [tab, setTab] = useState("files")
  const [fileQuery, setFileQuery] = useState("")
  const [taskQuery, setTaskQuery] = useState("")
  const [packageOpen, setPackageOpen] = useState<Record<string, boolean>>({})
  const [filters, setFilters] = useState<FileFilters>(defaultFileFilters)
  const [folderOpen, setFolderOpen] = useState(true)
  const [resultsOpen, setResultsOpen] = useState(true)
  const [runOpen, setRunOpen] = useState<Record<string, boolean>>({})
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [refreshing, setRefreshing] = useState(false)
  const selectedSet = useMemo(() => new Set(selected), [selected])
  const filterCount =
    Number(filters.kind !== "all") +
    Number(filters.band !== "all") +
    Number(!!(filters.minExposure || filters.maxExposure))
  const narrowed = !!fileQuery.trim() || filterCount > 0
  const source = useMemo(
    () => partitionFiles(workspace.files),
    [workspace.files]
  )
  const folder = filterFiles(source.folder, fileQuery, filters)
  const runs = source.runs
    .map((run) => ({
      ...run,
      files: filterFiles(run.files, fileQuery, filters),
    }))
    .filter((run) => run.files.length)
  const resultCount = runs.reduce((sum, run) => sum + run.files.length, 0)
  const limit = (key: string) => limits[key] || 80
  const isRunOpen = (id: string) => runOpen[id] ?? narrowed
  const shown = new Set(
    [
      ...(folderOpen ? folder.slice(0, limit("folder")) : []),
      ...(resultsOpen
        ? runs
            .filter((run) => isRunOpen(run.id))
            .flatMap((run) => run.files.slice(0, limit(run.id)))
        : []),
    ].map((file) => file.id)
  )
  const hiddenSelected = hiddenSelectionCount(selected, shown)
  const bands = [
    ...new Set(
      workspace.files
        .map((file) => file.filter)
        .filter((value): value is string => !!value)
    ),
  ].sort()

  function revealMatches() {
    setLimits({})
    setFolderOpen(true)
    setResultsOpen(true)
    setRunOpen({})
  }
  function changeFilters(next: FileFilters) {
    setFilters(next)
    revealMatches()
  }
  function fileList(files: Frame[], key: string) {
    return (
      <>
        <SidebarMenu>
          {files.slice(0, limit(key)).map((file) => (
            <FileRow
              key={file.id}
              file={file}
              selected={selectedSet.has(file.id)}
              onSelect={onSelect}
              onOpen={props.onOpen}
            />
          ))}
        </SidebarMenu>
        {files.length > limit(key) && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() =>
              setLimits((values) => ({ ...values, [key]: limit(key) + 80 }))
            }
          >
            더 보기 <CountBadge count={files.length - limit(key)} />
          </Button>
        )}
      </>
    )
  }
  const matchingTasks =
    props.catalog?.tasks.filter((task) =>
      `${task.name} ${task.title} ${task.package}`
        .toLowerCase()
        .includes(taskQuery.trim().toLowerCase())
    ) || []

  function packageBranch(node: TaskPackage) {
    const stateKey = `${taskQuery.trim()}:${node.path}`
    return <SidebarMenuItem key={node.path}>
      <Collapsible open={packageOpen[stateKey] ?? !!taskQuery.trim()} onOpenChange={open => setPackageOpen(previous => ({...previous, [stateKey]: open}))} className="group/package">
        <CollapsibleTrigger render={<SidebarMenuButton />} title={node.path} className="[&[aria-expanded=true]>svg:last-child]:rotate-90">
          <Folder />
          <span>{node.label}</span>
          <ChevronRight className="ml-auto transition-transform" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {node.children.map(packageBranch)}
            {node.tasks.map(task => <SidebarMenuSubItem key={task.name}>
              <SidebarMenuSubButton render={<button />} title={`${task.package}.${task.taskName || taskDisplayName(task.name)}`} aria-label={`${task.name} 추가`} onClick={() => props.onAddTask(task.name)}>
                <Terminal />
                <span className="min-w-0 flex-1 truncate">{task.taskName || taskDisplayName(task.name)}</span>
                {task.runnable === false && <span className="shrink-0 text-muted-foreground" title={task.reason}>실행 미지원</span>}
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>)}
          </SidebarMenuSub>
        </CollapsibleContent>
      </Collapsible>
    </SidebarMenuItem>
  }
  return (
    <TooltipProvider delay={0}>
      <Sidebar collapsible="offcanvas" aria-label="자료와 작업 탐색">
        <Tabs
          value={tab}
          onValueChange={(value) => setTab(String(value))}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <SidebarHeader>
            <div className="flex justify-end md:hidden">
              <SidebarTrigger aria-label="사이드바 닫기" />
            </div>
            <TabsList className="w-full" aria-label="탐색 대상">
              <TabsTrigger value="files">파일</TabsTrigger>
              <TabsTrigger value="tasks">작업</TabsTrigger>
            </TabsList>
            <div className="flex min-w-0 items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                <SidebarInput
                  className="pl-9"
                  aria-label={tab === "files" ? "파일 검색" : "작업 검색"}
                  placeholder={tab === "files" ? "파일명 검색" : "작업 검색"}
                  value={tab === "files" ? fileQuery : taskQuery}
                  onChange={(event) => {
                    if (tab === "files") {
                      setFileQuery(event.target.value)
                      revealMatches()
                    } else setTaskQuery(event.target.value)
                  }}
                />
              </div>
              {(tab === "files" ? fileQuery : taskQuery) && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="검색 초기화"
                  onClick={() => {
                    if (tab === "files") {
                      setFileQuery("")
                      revealMatches()
                    } else setTaskQuery("")
                  }}
                >
                  <X />
                </Button>
              )}
              {tab === "files" && (
                <FileFilterButton
                  filters={filters}
                  bands={bands}
                  onChange={changeFilters}
                />
              )}
            </div>
          </SidebarHeader>
          <SidebarContent
            className="scroll-fade scroll-fade-4"
            aria-busy={(!props.ready && !props.loadError) || refreshing}
          >
            {props.loadError ? (
              <NoFiles>자료를 불러오지 못했습니다.</NoFiles>
            ) : !props.ready || refreshing ? (
              <div role="status" aria-label="자료 불러오는 중" className="flex flex-col gap-6 p-4">
                {[0, 1].map((group) => (
                  <div key={group} aria-hidden="true" className="flex flex-col gap-3">
                    <Skeleton className="h-4 w-24" />
                    {[0, 1, 2, 3].map((row) => (
                      <Skeleton key={row} className="h-8 w-full" />
                    ))}
                  </div>
                ))}
              </div>
            ) : (
              <>
            <TabsContent value="files" className="min-h-0">
              <SidebarGroup className="py-0">
                <SidebarGroupLabel className="justify-between gap-2">
                  <span role="status" className="flex items-center gap-2">
                    {`파일 ${folder.length + resultCount}개`}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="자료 새로고침"
                      disabled={!props.ready || refreshing}
                      onClick={async () => {
                        setRefreshing(true)
                        try {
                          await props.onRefresh()
                        } catch (error) {
                          props.onError(
                            error instanceof Error
                              ? error.message
                              : "자료를 새로고침하지 못했습니다."
                          )
                        } finally {
                          setRefreshing(false)
                        }
                      }}
                    >
                      <RefreshCw
                        className={refreshing ? "animate-spin" : undefined}
                      />
                    </Button>
                  </div>
                </SidebarGroupLabel>
              </SidebarGroup>
              <SourceGroup
                label="열린 폴더"
                count={folder.length}
                open={folderOpen}
                onOpenChange={setFolderOpen}
              >
                {folder.length ? (
                  fileList(folder, "folder")
                ) : (
                  <NoFiles>
                    {narrowed
                        ? "조건에 맞는 폴더 파일이 없습니다."
                        : "이 폴더에 FITS 파일이 없습니다."}
                  </NoFiles>
                )}
              </SourceGroup>
              <SourceGroup
                label="실행 결과"
                count={resultCount}
                open={resultsOpen}
                onOpenChange={setResultsOpen}
              >
                <SidebarMenu>
                  {runs.map((run) => {
                    const job = props.jobs.find((job) => job.id === run.id)
                    const identity = job?.task || job?.manifest?.task || job?.name || "실행"
                    const name = taskDisplayName(identity)
                    return (
                      <SidebarMenuItem key={run.id}>
                        <Collapsible
                          open={isRunOpen(run.id)}
                          onOpenChange={(open) =>
                            setRunOpen((values) => ({
                              ...values,
                              [run.id]: open,
                            }))
                          }
                          className="group/run"
                        >
                          <CollapsibleTrigger
                            render={<SidebarMenuButton size="lg" />}
                            aria-label={`${name} ${runLabel(run.id)} 결과 ${run.files.length}개`}
                          >
                            <ChevronRight className="transition-transform group-data-open/run:rotate-90" />
                            <span className="flex min-w-0 flex-1 flex-col">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="truncate" title={identity}>{name}</span>
                                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{run.files.length}</span>
                              </span>
                              <span className="truncate text-muted-foreground">
                                {runLabel(run.id)}
                              </span>
                            </span>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              <SidebarMenuSubItem>
                                {fileList(run.files, run.id)}
                              </SidebarMenuSubItem>
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </Collapsible>
                      </SidebarMenuItem>
                    )
                  })}
                </SidebarMenu>
                {!runs.length && (
                  <NoFiles>
                    {narrowed
                        ? "조건에 맞는 실행 결과가 없습니다."
                        : "이 폴더에서 실행한 결과가 없습니다."}
                  </NoFiles>
                )}
              </SourceGroup>
              {workspace.sets.length > 0 && (
                <SidebarGroup>
                  <SidebarGroupLabel>저장한 선택</SidebarGroupLabel>
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {workspace.sets.map((set, index) => (
                        <SidebarMenuItem key={index}>
                          <SidebarMenuButton
                            onClick={() => onSelect([...new Set(set.ids)])}
                          >
                            <Folder />
                            <span>{set.name}</span>
                          </SidebarMenuButton>
                        </SidebarMenuItem>
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              )}
            </TabsContent>
            <TabsContent value="tasks" className="min-h-0">
              <SidebarGroup>
                <SidebarGroupLabel className="flex items-center justify-between">
                  <span className="flex min-w-0 items-center gap-2">
                    작업 <span className="tabular-nums text-muted-foreground">{matchingTasks.length}</span>
                  </span>
                  {props.onRefreshCatalog && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="작업 목록 새로고침"
                      disabled={refreshing}
                      onClick={async () => {
                        setRefreshing(true)
                        try {
                          await props.onRefreshCatalog?.()
                        } catch (error) {
                          props.onError((error as Error).message)
                        } finally {
                          setRefreshing(false)
                        }
                      }}
                    >
                      <RefreshCw
                        className={refreshing ? "animate-spin" : undefined}
                      />
                    </Button>
                  )}
                </SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {taskPackageTree(matchingTasks).map(packageBranch)}
                  </SidebarMenu>
                  {!matchingTasks.length && (
                    <NoFiles>
                      {taskQuery ? (
                        <>
                          {"검색 결과가 없습니다."}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTaskQuery("")}
                          >
                            검색 초기화
                          </Button>
                        </>
                      ) : (
                        "사용 가능한 작업이 없습니다."
                      )}
                    </NoFiles>
                  )}
                </SidebarGroupContent>
              </SidebarGroup>
            </TabsContent>
              </>
            )}
          </SidebarContent>
          <SidebarFooter className="max-h-[50dvh] overflow-y-auto">
            {selectedSet.size > 0 && (
              <>
                <div
                  className="flex flex-col gap-2 px-2"
                  role="region"
                  aria-label="선택한 파일 작업"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span role="status" className="flex items-center gap-2">
                      {`${selectedSet.size}개 선택`}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => onSelect([])}
                    >
                      해제
                    </Button>
                  </div>
                  {(tab !== "files" || hiddenSelected > 0) && (
                    <FieldDescription>
                      {tab !== "files"
                        ? "파일 탭에 선택한 자료가 있습니다."
                        : `현재 목록에 표시되지 않은 선택 ${hiddenSelected}개`}
                    </FieldDescription>
                  )}
                  <Button size="sm" className="w-full" onClick={props.onUse}>
                    작업에 사용
                  </Button>
                  <Button
                    size="sm"
                    className="w-full"
                    variant="outline"
                    onClick={props.onSave}
                  >
                    묶음 저장
                  </Button>
                </div>
                <SidebarSeparator />
              </>
            )}
            {props.children}
          </SidebarFooter>
        </Tabs>
      </Sidebar>
    </TooltipProvider>
  )
}
