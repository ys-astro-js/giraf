import { useState } from "react"
import { ChevronRight, Folder, Terminal } from "lucide-react"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { TooltipProvider } from "@/components/ui/tooltip"
import { Button } from "@/components/ui/button"
import { SearchField } from "@/components/search-field"
import { taskPackageTree, type TaskPackage } from "@/lib/task-tree"
import { taskDisplayName } from "@/lib/workbench"
import { useWorkbench } from "@/features/workbench/context"
import { ListBar, ListSkeleton, NoFiles, RefreshButton } from "./shared"
import { useRefresh } from "./lists"

/** IRAF packages and tasks; choosing a task adds it to the workflow. */
export function TasksPanel() {
  const w = useWorkbench()
  const [query, setQuery] = useState("")
  const [packageOpen, setPackageOpen] = useState<Record<string, boolean>>({})
  const { refreshing, refresh } = useRefresh(w.refreshCatalog, w.setError)
  const matchingTasks =
    w.catalog?.tasks.filter((task) =>
      `${task.name} ${task.title} ${task.package}`
        .toLowerCase()
        .includes(query.trim().toLowerCase())
    ) || []

  function packageBranch(node: TaskPackage) {
    const stateKey = `${query.trim()}:${node.path}`
    return (
      <SidebarMenuItem key={node.path}>
        <Collapsible
          open={packageOpen[stateKey] ?? !!query.trim()}
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
                    onClick={() => w.add(task.name, [])}
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
      <div className="library-window">
        <SidebarHeader>
          <div className="flex min-w-0 items-center gap-2">
            <SearchField
              className="min-w-0 flex-1"
              label="작업 검색"
              value={query}
              onValueChange={setQuery}
            />
          </div>
          <ListBar
            label="작업 관리"
            count={matchingTasks.length}
            leading={
              <RefreshButton
                label="작업 목록 새로고침"
                disabled={!w.ready}
                refreshing={refreshing}
                onRefresh={refresh}
              />
            }
          />
        </SidebarHeader>
        <SidebarContent
          className="scroll-fade scroll-fade-4"
          aria-busy={(!w.ready && !w.loadError) || refreshing}
        >
          {w.loadError ? (
            <NoFiles>자료를 불러오지 못했습니다.</NoFiles>
          ) : !w.ready || refreshing ? (
            <ListSkeleton />
          ) : (
            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {taskPackageTree(matchingTasks).map(packageBranch)}
                </SidebarMenu>
                {!matchingTasks.length && (
                  <NoFiles>
                    {query ? (
                      <>
                        {"검색 결과가 없습니다."}
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setQuery("")}
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
          )}
        </SidebarContent>
      </div>
    </TooltipProvider>
  )
}
