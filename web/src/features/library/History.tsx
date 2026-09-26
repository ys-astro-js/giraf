import type { ExecutionGroup } from "@/lib/execution-history"
import { type Dispatch, type ReactNode, type SetStateAction } from "react"
import {
  ChevronRight,
  Clock,
  Logs,
  CircleX,
  CircleAlert,
  CircleMinus,
  LoaderCircle,
} from "lucide-react"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuSub,
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
} from "@/components/ui/tooltip"
import { TabsContent } from "@/components/ui/tabs"
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { Checkbox } from "@/components/ui/checkbox"
import { runLabel, toggleFileSelection } from "@/lib/file-library"
import { taskDisplayName, type Frame } from "@/lib/workbench"
import { stateLabel } from "@/lib/task-map"
import type * as React from "react"

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
export function LibraryHistory({
  executions,
  runOpen,
  setRunOpen,
  selectionMode,
  runSelection,
  deletableRuns,
  setSelectionMode,
  setSelectedRuns,
  onViewLog,
  setOpenMobile,
  fileList,
}: {
  executions: ExecutionGroup[]
  runOpen: Record<string, boolean>
  setRunOpen: Dispatch<SetStateAction<Record<string, boolean>>>
  selectionMode: "files" | "history" | null
  runSelection: ExecutionGroup[]
  deletableRuns: ExecutionGroup[]
  setSelectionMode: Dispatch<SetStateAction<"files" | "history" | null>>
  setSelectedRuns: Dispatch<SetStateAction<string[]>>
  onViewLog: (id: string) => void
  setOpenMobile: (open: boolean) => void
  fileList: (files: Frame[], key: string) => React.JSX.Element
}) {
  return (
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
                  <div
                    className="library-file-row relative"
                    data-selecting={selectionMode === "history"}
                  >
                    <CollapsibleTrigger
                      render={
                        <SidebarMenuButton
                          size="lg"
                          className="pr-3! pl-10"
                          isActive={runSelection.includes(group)}
                        />
                      }
                      className="[&[aria-expanded=true]>svg]:rotate-90"
                    >
                      <ChevronRight className="library-file-icon absolute top-1/2 left-3 -translate-y-1/2" />
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
                    <Checkbox
                      className="library-file-checkbox absolute! top-1/2 left-3 -translate-y-1/2"
                      aria-label={`${runLabel(group.jobs[0].id)} 실행 선택`}
                      disabled={!deletableRuns.includes(group)}
                      checked={runSelection.includes(group)}
                      onCheckedChange={(checked) => {
                        setSelectionMode("history")
                        setSelectedRuns((ids) =>
                          toggleFileSelection(ids, group.id, checked)
                        )
                      }}
                    />
                  </div>
                  <CollapsibleContent>
                    <SidebarMenuSub className="mr-0 pr-0">
                      {group.jobs.map((job) => {
                        const name = taskDisplayName(job.task || job.name)
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
                                render={<SidebarMenuButton className="pr-9" />}
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
                                    onViewLog(job.id)
                                    setOpenMobile(false)
                                  }}
                                >
                                  <Logs />
                                </TooltipTrigger>
                                <TooltipContent>로그 보기</TooltipContent>
                              </Tooltip>
                              <CollapsibleContent>
                                <div className="pl-3">
                                  {job.products.length ? (
                                    fileList(job.products, job.id)
                                  ) : (
                                    <NoFiles>산출물이 없습니다.</NoFiles>
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
          {!executions.length && <NoFiles>실행 기록이 없습니다.</NoFiles>}
        </SidebarGroupContent>
      </SidebarGroup>
    </TabsContent>
  )
}
