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
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
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
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      disabled={disabled || refreshing}
      onClick={onRefresh}
    >
      <RefreshCw className={refreshing ? "animate-spin" : undefined} />
    </Button>
  )
}

export type ListSelection = {
  active: boolean
  selectedCount: number
  allLabel: string
  allChecked: boolean
  someChecked: boolean
  allDisabled: boolean
  onAll: (checked: boolean) => void
  onDone: () => void
  startLabel: string
  startDisabled: boolean
  onStart: () => void
}

/**
 * The count row above a list: item count and refresh, or while selecting,
 * the select-all checkbox, selected count and done.
 */
export function ListBar({
  label,
  count,
  leading,
  selection,
}: {
  label: string
  count: number
  leading?: ReactNode
  selection?: ListSelection
}) {
  return (
    <div
      className="flex min-h-9 min-w-0 flex-wrap items-center justify-between gap-x-1 gap-y-1"
      role="group"
      aria-label={label}
    >
      {selection?.active ? (
        <>
          <div className="flex min-w-0 items-center gap-2 pl-3">
            <Checkbox
              title="전체 선택"
              aria-label={selection.allLabel}
              disabled={selection.allDisabled}
              checked={selection.allChecked}
              indeterminate={selection.someChecked && !selection.allChecked}
              onCheckedChange={selection.onAll}
            />
            <span
              className="text-xs whitespace-nowrap text-muted-foreground"
              role="status"
              aria-label={`${selection.selectedCount}개 선택`}
            >
              {`${selection.selectedCount}개 항목`}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Button size="default" variant="ghost" onClick={selection.onDone}>
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
              {`${count}개 항목`}
            </span>
            {leading}
          </div>
          {selection && (
            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="default"
                variant="ghost"
                aria-label={selection.startLabel}
                disabled={selection.startDisabled}
                onClick={selection.onStart}
              >
                선택
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
