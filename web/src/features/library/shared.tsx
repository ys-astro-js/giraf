import { type Dispatch, type ReactNode, type SetStateAction } from "react"
import { FileImage, FileText, RefreshCw } from "lucide-react"
import type { Frame } from "@/lib/workbench"
import { SidebarMenuItem, SidebarMenuButton } from "@/components/ui/sidebar"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"
import { MiddleEllipsis } from "@/components/middle-ellipsis"
import { toggleFileSelection } from "@/lib/file-library"
import { Checkbox } from "@/components/ui/checkbox"
import {
  ToolbarButton,
  ToolbarGroup,
  ToolbarMorph,
  ToolbarSpacer,
} from "@/components/toolbar"
import { WindowTitle, WindowToolbar } from "@/features/dock/WindowToolbar"
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

export type SelectFiles = Dispatch<SetStateAction<string[]>>

export function FileRow({
  file,
  selected,
  selecting,
  onSelect,
  onOpen,
}: {
  file: Frame
  selected: boolean
  selecting: boolean
  onSelect: SelectFiles
  onOpen: (file: Frame) => void
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

export function NoFiles({ children }: { children: ReactNode }) {
  return (
    <Empty className="px-3 py-4">
      <EmptyHeader>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}

export function ListSkeleton() {
  return (
    <div
      role="status"
      aria-label="자료 불러오는 중"
      className="flex flex-col gap-6 p-4"
    >
      {[0, 1].map((group) => (
        <div key={group} aria-hidden="true" className="flex flex-col gap-3">
          <Skeleton className="h-4 w-24" />
          {[0, 1, 2, 3].map((row) => (
            <Skeleton key={row} className="h-8 w-full" />
          ))}
        </div>
      ))}
    </div>
  )
}

/** A refresh button that reports failures and spins while it works. */
export function RefreshButton({
  label,
  disabled,
  refreshing,
  onRefresh,
}: {
  label: string
  disabled: boolean
  refreshing: boolean
  onRefresh: () => void
}) {
  return (
    <ToolbarButton
      label={label}
      disabled={disabled || refreshing}
      onClick={onRefresh}
    >
      <RefreshCw className={refreshing ? "animate-spin" : undefined} />
    </ToolbarButton>
  )
}

export type ListSelection = {
  active: boolean
  selectedCount: number
  allLabel: string
  allChecked: boolean
  allDisabled: boolean
  onAll: (checked: boolean) => void
  onDone: () => void
  startLabel: string
  startDisabled: boolean
  onStart: () => void
}

/**
 * A list window's bars. The top bar titles the list with its count and holds
 * its actions: symbols (refresh, first to the overflow menu) apart from text
 * actions (select all, select or done), each in its own capsule.
 * The bottom bar holds search and filters, or while selecting, what to do
 * with the selection.
 */
export function ListBars({
  title,
  count,
  tools,
  selection,
  search,
  selectionActions,
}: {
  title: string
  count: number
  /** Symbol actions, hidden while selecting. */
  tools?: ReactNode
  selection?: ListSelection
  search?: ReactNode
  selectionActions?: ReactNode
}) {
  const selecting = !!selection?.active
  const bottom = selecting ? selectionActions : search
  return (
    <>
      <WindowTitle
        title={title}
        subtitle={
          selecting ? `${selection.selectedCount}개 선택` : `${count}개 항목`
        }
      />
      <WindowToolbar>
        {tools && (
          <ToolbarGroup label={`${title} 도구`} hidden={selecting} overflow>
            {tools}
          </ToolbarGroup>
        )}
        {selection && (
          <>
            {tools && <ToolbarSpacer />}
            <ToolbarGroup label="전체 선택" hidden={!selecting}>
              <ToolbarButton
                label={selection.allLabel}
                className="toolbar-text-button"
                disabled={selection.allDisabled}
                onClick={() => selection.onAll(!selection.allChecked)}
              >
                {selection.allChecked ? "선택 해제" : "전체 선택"}
              </ToolbarButton>
            </ToolbarGroup>
            <ToolbarSpacer />
            <ToolbarGroup label="선택">
              <ToolbarMorph
                active={selecting}
                idle="선택"
                activeContent="완료"
                label={selection.startLabel}
                activeLabel="선택 완료"
                disabled={!selecting && selection.startDisabled}
                onClick={selecting ? selection.onDone : selection.onStart}
              />
            </ToolbarGroup>
          </>
        )}
      </WindowToolbar>
      {bottom && <WindowToolbar placement="bottom">{bottom}</WindowToolbar>}
    </>
  )
}
