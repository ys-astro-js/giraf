import { MiddleEllipsis } from "@/components/middle-ellipsis"
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
  FolderClosed,
  Clock,
  SquareFunction,
  SlidersHorizontal,
  Logs,
  CircleX,
  CircleAlert,
  CircleMinus,
  LoaderCircle,
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
  SidebarMenuAction,
  useSidebar,
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
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Checkbox } from "@/components/ui/checkbox"
import { CountBadge } from "@/components/count-badge"
import { FileFilterButton } from "@/components/file-filter-button"
import {
  defaultFileFilters,
  filterFiles,
  partitionFiles,
  runLabel,
  toggleFileSelection,
  type FileFilters,
} from "@/lib/file-library"
import {
  taskDisplayName,
  type Catalog,
  type Frame,
  type Job,
  type Workspace,
} from "@/lib/workbench"

import { groupExecutions, type CurrentExecution } from "@/lib/execution-history"
import { stateLabel } from "@/lib/task-map"

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
  onSave: () => void
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

function JobStatus({ state }: { state: string }) {
  if (state === "completed") return null
  const Icon =
    state === "failed"
      ? CircleX
      : state === "partial"
        ? CircleAlert
        : state === "cancelled" || state === "skipped"
          ? CircleMinus
          : state === "running"
            ? LoaderCircle
            : Clock
  return (
    <Icon
      role="img"
      aria-label={stateLabel(state)}
      className={state === "running" ? "animate-spin" : undefined}
    >
      <title>{stateLabel(state)}</title>
    </Icon>
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
  const executions = groupExecutions(props.jobs, props.currentExecution)
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
              selecting={selectedSet.size > 0}
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
          onValueChange={(value) => setTab(String(value))}
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
            )}
            {(tab === "files" || tab === "tasks") && (
              <SidebarGroup className="p-0">
                <SidebarGroupLabel className="justify-between gap-2">
                  <span role="status">
                    {tab === "files"
                      ? `파일 ${folder.length}개`
                      : `작업 ${matchingTasks.length}개`}
                  </span>
                  {(tab === "files" || props.onRefreshCatalog) && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={
                        tab === "files" ? "자료 새로고침" : "작업 목록 새로고침"
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
                </SidebarGroupLabel>
              </SidebarGroup>
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
                                <span
                                  className="min-w-0 flex-1 truncate"
                                  title={set.name}
                                >
                                  {set.name}
                                </span>
                              </SidebarMenuButton>
                            </SidebarMenuItem>
                          ))}
                        </SidebarMenu>
                      </SidebarGroupContent>
                    </SidebarGroup>
                  )}
                </TabsContent>
                <TabsContent value="history" className="min-h-0">
                  <SidebarGroup>
                    <SidebarGroupContent>
                      <SidebarMenu>
                        {executions.map((group) => (
                          <SidebarMenuItem key={group.id}>
                            <Collapsible
                              open={!!runOpen[group.id]}
                              onOpenChange={(open) =>
                                setRunOpen((previous) => ({
                                  ...previous,
                                  [group.id]: open,
                                }))
                              }
                            >
                              <CollapsibleTrigger
                                render={
                                  <SidebarMenuButton
                                    size="lg"
                                    className="pr-3!"
                                  />
                                }
                                className="[&[aria-expanded=true]>svg]:rotate-90"
                              >
                                <ChevronRight />
                                <span className="flex min-w-0 flex-1 flex-col">
                                  <span className="flex min-w-0 items-center gap-2">
                                    <span
                                      className="min-w-0 flex-1 truncate"
                                      title={
                                        group.workflow
                                          ? "워크플로우 실행"
                                          : `${taskDisplayName(group.jobs[0].task || group.jobs[0].name)} 실행`
                                      }
                                    >
                                      {group.workflow
                                        ? "워크플로우 실행"
                                        : `${taskDisplayName(group.jobs[0].task || group.jobs[0].name)} 실행`}
                                    </span>
                                    <span className="ml-auto shrink-0 text-muted-foreground">
                                      {group.jobs.length}
                                    </span>
                                  </span>
                                  <span
                                    className="truncate text-muted-foreground"
                                    title={runLabel(group.jobs[0].id)}
                                  >
                                    {runLabel(group.jobs[0].id)}
                                  </span>
                                </span>
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <SidebarMenuSub className="mr-0 pr-0">
                                  {group.jobs.map((job) => {
                                    const name = taskDisplayName(
                                      job.task || job.name
                                    )
                                    return (
                                      <SidebarMenuItem key={job.id}>
                                        <Collapsible
                                          open={!!runOpen[job.id]}
                                          onOpenChange={(open) =>
                                            setRunOpen((previous) => ({
                                              ...previous,
                                              [job.id]: open,
                                            }))
                                          }
                                        >
                                          <CollapsibleTrigger
                                            render={
                                              <SidebarMenuButton className="pr-9" />
                                            }
                                            aria-label={`${name} 산출물 ${job.products.length}개`}
                                            className="[&[aria-expanded=true]>svg]:rotate-90"
                                          >
                                            <ChevronRight />
                                            <span
                                              className="min-w-0 flex-1 truncate"
                                              title={job.task || job.name}
                                            >
                                              {name}
                                            </span>
                                            <JobStatus state={job.state} />
                                          </CollapsibleTrigger>
                                          <Tooltip>
                                            <TooltipTrigger
                                              render={<SidebarMenuAction />}
                                              aria-label={`${name} 로그 보기`}
                                              onClick={() => {
                                                props.onViewLog(job.id)
                                                setOpenMobile(false)
                                              }}
                                            >
                                              <Logs />
                                            </TooltipTrigger>
                                            <TooltipContent>
                                              로그 보기
                                            </TooltipContent>
                                          </Tooltip>
                                          <CollapsibleContent>
                                            <div className="pl-3">
                                              {job.products.length ? (
                                                fileList(job.products, job.id)
                                              ) : (
                                                <NoFiles>
                                                  산출물이 없습니다.
                                                </NoFiles>
                                              )}
                                            </div>
                                          </CollapsibleContent>
                                        </Collapsible>
                                      </SidebarMenuItem>
                                    )
                                  })}
                                </SidebarMenuSub>
                              </CollapsibleContent>
                            </Collapsible>
                          </SidebarMenuItem>
                        ))}
                      </SidebarMenu>
                      {!executions.length && (
                        <NoFiles>실행 기록이 없습니다.</NoFiles>
                      )}
                    </SidebarGroupContent>
                  </SidebarGroup>
                </TabsContent>
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
          <SidebarFooter className="max-h-[50dvh] overflow-y-auto">
            {selectedSet.size > 0 && tab !== "settings" && (
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
          </SidebarFooter>
        </Tabs>
      </Sidebar>
    </TooltipProvider>
  )
}
