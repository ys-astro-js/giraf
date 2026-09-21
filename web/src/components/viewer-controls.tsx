import { useState, type ReactNode, type ComponentProps } from "react"
import { FolderOpen, LoaderCircle, type LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { toast } from "@/components/ui/toast"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { api } from "@/lib/workbench"

export function ViewerToolButton({
  label,
  ...props
}: ComponentProps<typeof Button> & { label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button variant="ghost" size="icon-sm" {...props} />}
        aria-label={label}
        data-slot="button"
      />
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function RevealFile({ id }: { id: string }) {
  const [busy, setBusy] = useState(false)
  const label = /Mac/.test(navigator.platform)
    ? "Finder에서 보기"
    : /Win/.test(navigator.platform)
      ? "탐색기에서 보기"
      : "파일 위치 열기"
  return (
    <ViewerToolButton
      label={label}
      disabled={busy}
      aria-busy={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await api("reveal", { id })
        } catch (error) {
          toast.add({ title: (error as Error).message, type: "error" })
        } finally {
          setBusy(false)
        }
      }}
    >
      {busy ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}
    </ViewerToolButton>
  )
}

export function ViewerPopover({
  label,
  icon: Icon,
  disabled,
  className,
  children,
}: {
  label: string
  icon: LucideIcon
  disabled?: boolean
  className?: string
  children: ReactNode
}) {
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={<Button variant="outline" size="icon-sm" />}
              disabled={disabled}
            />
          }
          aria-label={label}
          data-slot="button"
        >
          <Icon />
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align="end"
        sideOffset={8}
        className={cn(
          "max-h-(--available-height) max-w-[calc(100vw-2rem)] overflow-y-auto",
          className
        )}
      >
        <PopoverHeader>
          <PopoverTitle>{label}</PopoverTitle>
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  )
}
