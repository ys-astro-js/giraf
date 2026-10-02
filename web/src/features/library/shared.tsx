import { type ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import { ToolbarButton } from "@/components/toolbar"
import { Empty, EmptyHeader, EmptyDescription } from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"

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
