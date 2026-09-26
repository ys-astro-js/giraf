import { groupExecutions, type CurrentExecution } from "@/lib/execution-history"
import {
  type Frame,
  taskDisplayName,
  type Catalog,
  type Job,
  type Workspace,
} from "@/lib/workbench"
import {
  type Dispatch,
  type SetStateAction,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import {
  FolderClosed,
  Clock,
  SquareFunction,
  SlidersHorizontal,
  RefreshCw,
  Search,
  X,
  ChevronRight,
  FileImage,
  FileText,
  Folder,
  Terminal,
} from "lucide-react"
import {
  SidebarHeader,
  SidebarTrigger,
  SidebarInput,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  useSidebar,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip"
import { TabsList, TabsTrigger, Tabs, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FileFilterButton } from "@/components/file-filter-button"
import {
  type FileFilters,
  defaultFileFilters,
  filterFiles,
  partitionFiles,
  toggleFileSelection,
} from "@/lib/file-library"
import { LibraryHistory } from "./History"
import { DeleteSelectionButton } from "@/components/delete-selection-button"
import { MiddleEllipsis } from "@/components/middle-ellipsis"
import { taskPackageTree, type TaskPackage } from "@/lib/task-tree"
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible"
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import { CountBadge } from "@/components/count-badge"

type Props = {
  currentExecution?: CurrentExecution | null
  onViewLog: (id: string) => void
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
  onDeleteFiles: (ids: string[]) => Promise<void>
  onDeleteJobs: (ids: string[]) => Promise<void>
  children: ReactNode
}

function FileRow({
  file,
  selected,
  selecting,
  onSelect,
  onOpen,
}: Pick<Props, "onSelect" | "onOpen"> & {
  file: Frame
  selected: boolean
  selecting: boolean
}) {
  const Icon = ["text", "image-list"].includes(file.asset || "")
    ? FileText
    : FileImage
  return (
    <SidebarMenuItem className="library-file-row" data-selecting={selecting}>
      <Tooltip>
        <TooltipTrigger
          delay={0}
          render={<SidebarMenuButton className="pl-10" isActive={selected} />}
          onClick={() => onOpen(file)}
          aria-label={`${file.label} 열기`}
        >
          <Icon className="library-file-icon absolute top-1/2 left-3 -translate-y-1/2" />
          <MiddleEllipsis text={file.label} />
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
        className="library-file-checkbox absolute! top-1/2 left-3 -translate-y-1/2"
        aria-label={`${file.label} 선택`}
        checked={selected}
        onCheckedChange={(checked) =>
          onSelect((ids) => toggleFileSelection(ids, file.id, checked))
        }
      />
    </SidebarMenuItem>
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
  const { setOpenMobile } = useSidebar()
  const [tab, setTab] = useState("files")
  const [fileQuery, setFileQuery] = useState("")
  const [taskQuery, setTaskQuery] = useState("")
  const [packageOpen, setPackageOpen] = useState<Record<string, boolean>>({})
  const [filters, setFilters] = useState<FileFilters>(defaultFileFilters)
  const [runOpen, setRunOpen] = useState<Record<string, boolean>>({})
  const [limits, setLimits] = useState<Record<string, number>>({})
  const [selectionMode, setSelectionMode] = useState<
    "files" | "history" | null
  >(null)
  const [previousSelected, setPreviousSelected] = useState(selected)
  if (previousSelected !== selected) {
    setPreviousSelected(selected)
    if (
      selectionMode === "files" &&
      previousSelected.length &&
      !selected.length
    )
      setSelectionMode(null)
  }
  const selecting = selectionMode !== null
  const [selectedRuns, setSelectedRuns] = useState<string[]>([])
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
  const selectionFiles =
    tab === "files" ? folder : props.jobs.flatMap((job) => job.products)
  const executions = groupExecutions(props.jobs, props.currentExecution)
  const deletableRuns = executions.filter(
    (group) =>
      !group.jobs.some((job) =>
        ["queued", "running", "waiting"].includes(job.state)
      )
  )
  const runSelection = deletableRuns.filter((group) =>
    selectedRuns.includes(group.id)
  )
  const limit = (key: string) => limits[key] || 80
  const bands = [
    ...new Set(
      source.folder
        .map((file) => file.filter)
        .filter((value): value is string => !!value)
    ),
  ].sort()

  function revealMatches() {
    setLimits({})
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
              selecting={selectionMode === "files"}
              onSelect={(value) => {
                setSelectionMode("files")
                onSelect(value)
              }}
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
    return (
      <SidebarMenuItem key={node.path}>
        <Collapsible
          open={packageOpen[stateKey] ?? !!taskQuery.trim()}
          onOpenChange={(open) =>
            setPackageOpen((previous) => ({ ...previous, [stateKey]: open }))
          }
          className="group/package"
        >
          <CollapsibleTrigger
            render={<SidebarMenuButton />}
            title={node.path}
            className="[&[aria-expanded=true]>svg:last-child]:rotate-90"
          >
            <Folder />
            <span className="min-w-0 flex-1 truncate">{node.label}</span>
            <ChevronRight className="ml-auto transition-transform" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {node.children.map(packageBranch)}
              {node.tasks.map((task) => (
                <SidebarMenuSubItem key={task.name}>
                  <SidebarMenuSubButton
                    render={<button />}
                    title={`${task.package}.${task.taskName || taskDisplayName(task.name)}`}
                    aria-label={`${task.name} 추가`}
                    onClick={() => props.onAddTask(task.name)}
                  >
                    <Terminal />
                    <span className="min-w-0 flex-1 truncate">
                      {task.taskName || taskDisplayName(task.name)}
                    </span>
                    {task.runnable === false && (
                      <span
                        className="shrink-0 text-muted-foreground"
                        title={task.reason}
                      >
                        실행 미지원
                      </span>
                    )}
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </Collapsible>
      </SidebarMenuItem>
    )
  }
  return (
    <TooltipProvider delay={0}>
      <Sidebar collapsible="offcanvas" aria-label="자료와 작업 탐색">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            setTab(String(value))
            setSelectionMode(null)
            setSelectedRuns([])
            onSelect([])
          }}
          className="flex min-h-0 flex-1 flex-col gap-0"
        >
          <SidebarHeader>
            <div className="flex justify-end md:hidden">
              <SidebarTrigger aria-label="사이드바 닫기" />
            </div>
            <TabsList className="w-full" aria-label="탐색 대상">
              {[
                { value: "files", label: "파일", icon: FolderClosed },
                { value: "history", label: "실행 기록", icon: Clock },
                { value: "tasks", label: "작업", icon: SquareFunction },
                { value: "settings", label: "설정", icon: SlidersHorizontal },
              ].map(({ value, label, icon: Icon }) => (
                <Tooltip key={value}>
                  <TooltipTrigger render={<TabsTrigger value={value} />}>
                    <Icon />
                    <span className="sr-only">{label}</span>
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </TabsList>
            {(tab === "files" || tab === "tasks") && (
              <div className="flex h-9 min-w-0 items-center gap-2">
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
                    size="icon"
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
            )}
            {tab !== "settings" && (
              <div
                className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-1 gap-y-1"
                role="group"
                aria-label={
                  tab === "files"
                    ? "파일 관리"
                    : tab === "history"
                      ? "실행 기록 관리"
                      : "작업 관리"
                }
              >
                {selecting ? (
                  <>
                    <div className="flex min-w-0 items-center gap-2 pl-3">
                      <Checkbox
                        title="전체 선택"
                        aria-label={
                          selectionMode === "files"
                            ? "표시된 파일 전체 선택"
                            : "실행 기록 전체 선택"
                        }
                        disabled={
                          !props.ready ||
                          (selectionMode === "files"
                            ? !selectionFiles.length
                            : !deletableRuns.length)
                        }
                        checked={
                          selectionMode === "files"
                            ? selectionFiles.length > 0 &&
                              selectionFiles.every((file) =>
                                selectedSet.has(file.id)
                              )
                            : deletableRuns.length > 0 &&
                              runSelection.length === deletableRuns.length
                        }
                        indeterminate={
                          selectionMode === "files"
                            ? selectionFiles.some((file) =>
                                selectedSet.has(file.id)
                              ) &&
                              !selectionFiles.every((file) =>
                                selectedSet.has(file.id)
                              )
                            : runSelection.length > 0 &&
                              runSelection.length < deletableRuns.length
                        }
                        onCheckedChange={(checked) => {
                          if (selectionMode === "files")
                            onSelect((ids) =>
                              checked
                                ? [
                                    ...new Set([
                                      ...ids,
                                      ...selectionFiles.map((file) => file.id),
                                    ]),
                                  ]
                                : ids.filter(
                                    (id) =>
                                      !selectionFiles.some(
                                        (file) => file.id === id
                                      )
                                  )
                            )
                          else
                            setSelectedRuns(
                              checked
                                ? deletableRuns.map((group) => group.id)
                                : []
                            )
                        }}
                      />
                      <span
                        className="text-xs whitespace-nowrap text-muted-foreground"
                        role="status"
                        aria-label={`${selectionMode === "files" ? selected.length : runSelection.length}개 선택`}
                      >
                        {`${selectionMode === "files" ? selected.length : runSelection.length}개 항목`}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Button
                        size="default"
                        variant="ghost"
                        onClick={() => {
                          setSelectionMode(null)
                          setSelectedRuns([])
                          onSelect([])
                        }}
                      >
                        완료
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex min-w-0 items-center gap-1 pl-3">
                      <span
                        role="status"
                        className="text-xs whitespace-nowrap text-muted-foreground"
                      >
                        {`${tab === "files" ? folder.length : tab === "history" ? executions.length : matchingTasks.length}개 항목`}
                      </span>
                      {(tab === "files" ||
                        (tab === "tasks" && props.onRefreshCatalog)) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={
                            tab === "files"
                              ? "자료 새로고침"
                              : "작업 목록 새로고침"
                          }
                          disabled={!props.ready || refreshing}
                          onClick={async () => {
                            setRefreshing(true)
                            try {
                              if (tab === "files") await props.onRefresh()
                              else await props.onRefreshCatalog?.()
                            } catch (error) {
                              props.onError(
                                error instanceof Error
                                  ? error.message
                                  : "목록을 새로고침하지 못했습니다."
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
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {tab !== "tasks" && (
                        <Button
                          size="default"
                          variant="ghost"
                          aria-label={
                            tab === "files"
                              ? "파일 선택 모드"
                              : "실행 기록 선택 모드"
                          }
                          disabled={
                            !props.ready ||
                            (tab === "files"
                              ? !folder.length
                              : !deletableRuns.length)
                          }
                          onClick={() =>
                            setSelectionMode(tab as "files" | "history")
                          }
                        >
                          선택
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </SidebarHeader>
          <SidebarContent
            className="scroll-fade scroll-fade-4"
            aria-busy={(!props.ready && !props.loadError) || refreshing}
          >
            <TabsContent value="settings" className="min-h-0">
              <SidebarGroup>
                <SidebarGroupContent className="flex flex-col gap-4">
                  {props.children}
                </SidebarGroupContent>
              </SidebarGroup>
            </TabsContent>
            {tab === "settings" ? null : props.loadError ? (
              <NoFiles>자료를 불러오지 못했습니다.</NoFiles>
            ) : !props.ready || refreshing ? (
              <div
                role="status"
                aria-label="자료 불러오는 중"
                className="flex flex-col gap-6 p-4"
              >
                {[0, 1].map((group) => (
                  <div
                    key={group}
                    aria-hidden="true"
                    className="flex flex-col gap-3"
                  >
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
                </TabsContent>
                <LibraryHistory
                  executions={executions}
                  runOpen={runOpen}
                  setRunOpen={setRunOpen}
                  selectionMode={selectionMode}
                  runSelection={runSelection}
                  deletableRuns={deletableRuns}
                  setSelectionMode={setSelectionMode}
                  setSelectedRuns={setSelectedRuns}
                  onViewLog={props.onViewLog}
                  setOpenMobile={setOpenMobile}
                  fileList={fileList}
                />
                <TabsContent value="tasks" className="min-h-0">
                  <SidebarGroup>
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
          {selecting && (
            <SidebarFooter>
              <div
                className="flex min-h-9 flex-wrap items-center justify-end gap-4"
                role="group"
                aria-label={
                  selectionMode === "files"
                    ? "선택한 파일 작업"
                    : "선택한 실행 기록 작업"
                }
              >
                {selectionMode === "files" && (
                  <Button
                    className="min-w-0 flex-1"
                    disabled={!selected.length}
                    onClick={props.onUse}
                  >
                    작업에 사용
                  </Button>
                )}
                <DeleteSelectionButton
                  ids={
                    selectionMode === "files"
                      ? selected
                      : runSelection.map((group) => group.id)
                  }
                  label={
                    selectionMode === "files"
                      ? "선택한 파일 삭제"
                      : "선택한 실행 기록 삭제"
                  }
                  description={
                    selectionMode === "files"
                      ? "휴지통에서 복원할 수 있습니다."
                      : "산출물도 함께 이동합니다. 원본 파일은 유지됩니다."
                  }
                  onDelete={async (ids) => {
                    if (selectionMode === "files")
                      await props.onDeleteFiles(ids)
                    else {
                      await props.onDeleteJobs(
                        executions
                          .filter((group) => ids.includes(group.id))
                          .flatMap((group) => group.jobs.map((job) => job.id))
                      )
                    }
                    onSelect([])
                    setSelectedRuns([])
                    setSelectionMode(null)
                  }}
                />
              </div>
            </SidebarFooter>
          )}
        </Tabs>
      </Sidebar>
    </TooltipProvider>
  )
}
