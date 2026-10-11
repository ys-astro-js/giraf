import { useRef, useState, type ReactNode } from "react"
import { ChevronLeft, ChevronRight, Folder, Plus, Terminal } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
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
import { NodeIcon } from "@/components/node-icon"
import { SearchField } from "@/components/search-field"
import { ToolbarButton, ToolbarCluster, ToolbarGroup } from "@/components/toolbar"
import { nodeTiles } from "@/lib/node-chunks"
import { taskPackageTree, taskRowText, type TaskPackage } from "@/lib/task-tree"
import { isGirafNode, type Spec } from "@/lib/workbench"
import { useWorkbench } from "@/features/workbench/context"
import { CommandEntry } from "./CommandEntry"
import { ListSkeleton, NoFiles, RefreshButton } from "./shared"
import { useRefresh } from "./useRefresh"
import "@/styles/library/popovers.css"

const matches = (task: Spec, query: string) =>
  `${task.name} ${task.taskName ?? ""} ${task.title} ${task.package}`
    .toLowerCase()
    .includes(query.trim().toLowerCase())

/** One task to add: its name and package, and what it does. */
function TaskOption({ task, onAdd, showPackage = true }: { task: Spec; onAdd: () => void; showPackage?: boolean }) {
  const { name, package: path, description } = taskRowText(task)
  return (
    <button
      type="button"
      className="library-option"
      title={path ? `${path}.${name}` : name}
      aria-label={`${name} 추가`}
      onClick={onAdd}
    >
      <NodeIcon icon={task.icon} run={task.run} />
      <span className="library-option-text library-task-text">
        <span className="library-task-title">
          <span className="library-option-name">{name}</span>
          {showPackage && path && <span className="library-option-detail library-task-package">{path}</span>}
        </span>
        {(task.runnable === false || description) && (
          <span className="library-option-detail">
            {task.runnable === false && <span className="library-task-flag">실행 미지원</span>}
            {description}
          </span>
        )}
      </span>
    </button>
  )
}

/** A small tile above the package tree: an icon and a name, what it does in the tooltip. */
function Tile({ label, description, icon, onClick }: { label: string; description?: string; icon: ReactNode; onClick: () => void }) {
  const tile = (
    <button type="button" className="library-option library-tile" onClick={onClick}>
      {icon}
      <span className="library-option-name">{label}</span>
    </button>
  )
  if (!description) return tile
  return (
    <Tooltip>
      <TooltipTrigger render={tile} />
      <TooltipContent side="bottom">{description}</TooltipContent>
    </Tooltip>
  )
}

/**
 * The toolbar's way to add a task: a search over IRAF's tasks, or with no
 * query, GIRAF's node tiles and the package tree to browse. The 명령 tile
 * turns the body into CL command entry (CommandEntry). The workflow canvas,
 * the node window and other places open it through `setAddOpen`.
 */
export function AddTaskButton() {
  const w = useWorkbench()
  const [query, setQuery] = useState("")
  const [commands, setCommands] = useState(false)
  const [packageOpen, setPackageOpen] = useState<Record<string, boolean>>({})
  const { refreshing, refresh } = useRefresh(w.refreshCatalog, w.setError)
  const search = useRef<HTMLInputElement>(null)
  const entry = useRef<HTMLTextAreaElement>(null)
  const tasks = w.catalog?.tasks ?? []
  // A pset node is taken out of a task's pset (inspector), not added empty.
  // The 값 node's other 가져오기 runs have no tile but are found by search.
  const nodes = tasks.filter((task) => isGirafNode(task) && task.run !== "pset")
  const irafTasks = tasks.filter((task) => !isGirafNode(task))
  const foundNodes = query.trim()
    ? nodes.filter((task) => matches(task, query))
    : []
  const foundTasks = query.trim()
    ? irafTasks.filter((task) => matches(task, query))
    : []
  const found = [...foundNodes, ...foundTasks]
  const add = (task: Spec) => w.add(task.name)

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
            <TaskOption key={task.name} task={task} showPackage={false} onAdd={() => add(task)} />
          ))}
        </CollapsibleContent>
      </Collapsible>
    )
  }

  return (
    <ToolbarGroup label="작업 추가">
      <Popover
        open={w.addOpen}
        onOpenChange={(open, details) => {
          // Esc in command entry goes back to the list.
          if (!open && commands && details.reason === "escape-key") {
            details.cancel()
            setCommands(false)
            return
          }
          w.setAddOpen(open)
          if (!open) {
            setQuery("")
            setCommands(false)
          }
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
          className={commands ? "library-popover library-popover-wide" : "library-popover"}
          initialFocus={commands ? entry : search}
        >
          <PopoverTitle className="sr-only">작업 추가</PopoverTitle>
          {commands ? (
            <>
              <div className="library-popover-bar">
                <ToolbarCluster edge="start">
                  <ToolbarGroup label="이동">
                    <ToolbarButton label="목록으로" onClick={() => setCommands(false)}>
                      <ChevronLeft />
                    </ToolbarButton>
                  </ToolbarGroup>
                </ToolbarCluster>
                <span className="library-option-name">명령</span>
              </div>
              <CommandEntry
                inputRef={entry}
                onDone={() => {
                  setCommands(false)
                  w.setAddOpen(false)
                }}
              />
            </>
          ) : (
          <>
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
                <>
                  {!!foundNodes.length && (
                    <div className="library-nodes">
                      {foundNodes.map((task) => (
                        <TaskOption
                          key={task.name}
                          task={task}
                          onAdd={() => add(task)}
                        />
                      ))}
                    </div>
                  )}
                  {foundTasks.map((task) => (
                    <TaskOption
                      key={task.name}
                      task={task}
                      onAdd={() => add(task)}
                    />
                  ))}
                </>
              ) : (
                <NoFiles>검색 결과가 없습니다.</NoFiles>
              )
            ) : (
              <>
                <div className="library-nodes library-tiles">
                  {nodeTiles(nodes).map((task) => (
                    <Tile
                      key={task.name}
                      label={taskRowText(task).name}
                      description={taskRowText(task).description}
                      icon={<NodeIcon icon={task.icon} run={task.run} />}
                      onClick={() => add(task)}
                    />
                  ))}
                  <Tile
                    label="명령"
                    description="IRAF 명령으로 노드 만들기"
                    icon={<Terminal aria-hidden="true" />}
                    onClick={() => setCommands(true)}
                  />
                </div>
                {taskPackageTree(irafTasks).map(branch)}
              </>
            )}
          </div>
          </>
          )}
        </PopoverContent>
      </Popover>
    </ToolbarGroup>
  )
}
