import { useRef, useState } from "react"
import { ChevronRight, Folder, Plus, Terminal } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { SearchField } from "@/components/search-field"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { taskPackageTree, type TaskPackage } from "@/lib/task-tree"
import { taskDisplayName, type Spec } from "@/lib/workbench"
import { useWorkbench } from "@/features/workbench/context"
import { ListSkeleton, NoFiles, RefreshButton } from "./shared"
import { useRefresh } from "./lists"
import "@/styles/library/popovers.css"

const matches = (task: Spec, query: string) =>
  `${task.name} ${task.taskName ?? ""} ${task.title} ${task.package}`
    .toLowerCase()
    .includes(query.trim().toLowerCase())

/** One task to add: its name and what it does. */
function TaskOption({ task, onAdd }: { task: Spec; onAdd: () => void }) {
  const name = task.taskName || taskDisplayName(task.name)
  return (
    <button
      type="button"
      className="library-option"
      title={`${task.package}.${name}`}
      aria-label={`${name} 추가`}
      onClick={onAdd}
    >
      <Terminal aria-hidden="true" />
      <span className="library-option-text">
        <span className="library-option-name">{name}</span>
        <span className="library-option-detail">
          {task.runnable === false
            ? `실행 미지원 · ${task.package}`
            : task.title || task.package}
        </span>
      </span>
    </button>
  )
}

/**
 * The toolbar's way to add a task: a search over IRAF's tasks, or with no
 * query, the package tree to browse. The workflow canvas, the node window
 * and other places open it through `setAddOpen`.
 */
export function AddTaskButton() {
  const w = useWorkbench()
  const [query, setQuery] = useState("")
  const [packageOpen, setPackageOpen] = useState<Record<string, boolean>>({})
  const { refreshing, refresh } = useRefresh(w.refreshCatalog, w.setError)
  const search = useRef<HTMLInputElement>(null)
  const tasks = w.catalog?.tasks ?? []
  const found = query.trim() ? tasks.filter((task) => matches(task, query)) : []
  const add = (task: Spec) => w.add(task.name, [])

  function branch(node: TaskPackage) {
    return (
      <Collapsible
        key={node.path}
        open={!!packageOpen[node.path]}
        onOpenChange={(open) =>
          setPackageOpen((previous) => ({ ...previous, [node.path]: open }))
        }
      >
        <CollapsibleTrigger
          className="library-option library-package"
          title={node.path}
        >
          <ChevronRight aria-hidden="true" className="library-chevron" />
          <Folder aria-hidden="true" />
          <span className="library-option-name">{node.label}</span>
        </CollapsibleTrigger>
        <CollapsibleContent className="library-branch">
          {node.children.map(branch)}
          {node.tasks.map((task) => (
            <TaskOption key={task.name} task={task} onAdd={() => add(task)} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <ToolbarGroup label="작업 추가">
      <Popover
        open={w.addOpen}
        onOpenChange={(open) => {
          w.setAddOpen(open)
          if (!open) setQuery("")
        }}
      >
        <PopoverTrigger
          render={<ToolbarButton label="작업 추가" disabled={!w.catalog} />}
        >
          <Plus />
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="library-popover"
          initialFocus={search}
        >
          <PopoverTitle className="sr-only">작업 추가</PopoverTitle>
          <div className="library-popover-bar">
            <SearchField
              inputRef={search}
              label="추가할 작업 검색"
              placeholder="작업 검색"
              value={query}
              onValueChange={setQuery}
              onKeyDown={(event) => {
                if (event.key === "Enter" && found[0]) add(found[0])
              }}
            />
            <RefreshButton
              label="작업 목록 새로고침"
              disabled={!w.ready}
              refreshing={refreshing}
              onRefresh={refresh}
            />
          </div>
          <div
            className="library-popover-list scroll-fade scroll-fade-4"
            aria-busy={refreshing}
          >
            {!w.catalog || refreshing ? (
              <ListSkeleton />
            ) : query.trim() ? (
              found.length ? (
                found.map((task) => (
                  <TaskOption
                    key={task.name}
                    task={task}
                    onAdd={() => add(task)}
                  />
                ))
              ) : (
                <NoFiles>검색 결과가 없습니다.</NoFiles>
              )
            ) : (
              taskPackageTree(tasks).map(branch)
            )}
          </div>
        </PopoverContent>
      </Popover>
    </ToolbarGroup>
  )
}
