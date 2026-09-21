import {
  FolderOpen,
  LoaderCircle,
  CirclePause,
  CircleCheck,
  CircleAlert,
  CircleStop,
  Play,
  Square,
  PanelRight,
  PanelBottom,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip"

import type { ExecutionStatus } from "@/lib/execution-status"
export type { ExecutionStatus } from "@/lib/execution-status"

const statusIcons = {
  running: LoaderCircle,
  waiting: CirclePause,
  completed: CircleCheck,
  failed: CircleAlert,
  cancelled: CircleStop,
}

type Props = {
  executionStatus?: ExecutionStatus
  folder: string
  ready: boolean
  loading: boolean
  onFolder: () => void
  workflowBusy: boolean
  runDisabled: boolean
  onRun: () => void
  onCancel: () => void
  settingsVisible: boolean
  trayOpen: boolean
  onSettings: (open: boolean) => void
  onTray: (open: boolean) => void
}

export function WorkbenchToolbar(props: Props) {
  const status = props.executionStatus
  const showFolder = !props.workflowBusy && status?.state !== "running" && status?.state !== "waiting"
  const progressPercent = status?.progressFraction !== undefined && Number.isFinite(status.progressFraction)
    ? Math.round(Math.max(0, Math.min(1, status.progressFraction)) * 100)
    : undefined
  const StatusIcon = status ? statusIcons[status.state] : LoaderCircle
  return (
    <header className="workbench-toolbar" aria-label="도구 막대">
      <div className="toolbar-leading">
        <SidebarTrigger
          variant="outline"
          size="icon"
          aria-label="사이드바 열기 또는 닫기"
        />
        <Button
          size="icon"
          variant={props.workflowBusy ? "outline" : "default"}
          aria-label={props.workflowBusy ? "중단" : "일괄 실행"}
          title={props.workflowBusy ? "중단" : "일괄 실행"}
          onClick={props.workflowBusy ? props.onCancel : props.onRun}
          disabled={!props.workflowBusy && props.runDisabled}
        >
          {props.workflowBusy ? <Square /> : <Play />}
        </Button>
      </div>
      <div className="toolbar-status text-sm" role="status" aria-live="polite" aria-atomic="true">
        <div className="toolbar-status-content" data-state={status?.state || "idle"} title={status?.label}>
          {showFolder && (props.loading ? (
            <Skeleton aria-label="폴더 불러오는 중" className="h-6 w-32" />
          ) : (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size={status ? "icon-xs" : "xs"} className={status ? undefined : "min-w-0 flex-1 justify-start"} disabled={!props.ready} />}
                onClick={props.onFolder}
                disabled={!props.ready}
                aria-label="폴더 열기"
              >
                <FolderOpen data-icon={status ? undefined : "inline-start"} />
                {!status && <span className="truncate">{props.folder.split("/").filter(Boolean).at(-1) || props.folder || "폴더 열기"}</span>}
              </TooltipTrigger>
              <TooltipContent className="max-w-80 break-all">{props.folder || "폴더 열기"}</TooltipContent>
            </Tooltip>
          ))}
          {status ? (
            <>
            {progressPercent !== undefined && (
              <span
                className="toolbar-status-fill"
                role="progressbar"
                aria-label={`${status.name} 진행률`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                style={{ width: `${progressPercent}%` }}
              />
            )}
            <StatusIcon
              aria-hidden="true"
              className={status.state === "running" ? "size-4 shrink-0 motion-safe:animate-spin" : "size-4 shrink-0"}
            />
            <span className="toolbar-status-name font-medium">{status.name}</span>
            <span className="sr-only">{status.label}</span>
            {status.progress && (
              <span className="toolbar-status-progress text-muted-foreground tabular-nums">{status.progress}</span>
            )}
            </>
          ) : <span className="sr-only">실행 대기</span>}
        </div>
      </div>
      <ButtonGroup className="toolbar-panels" aria-label="패널 표시">
        <Button
          size="icon"
          variant="outline"
          aria-label={props.trayOpen ? "하단 패널 닫기" : "하단 패널 열기"}
          title={props.trayOpen ? "하단 패널 닫기" : "하단 패널 열기"}
          onClick={() => props.onTray(!props.trayOpen)}
        >
          <PanelBottom />
        </Button>
        <Button
          size="icon"
          variant="outline"
          aria-label={
            props.settingsVisible ? "설정 패널 닫기" : "설정 패널 열기"
          }
          title={props.settingsVisible ? "설정 패널 닫기" : "설정 패널 열기"}
          onClick={() => props.onSettings(!props.settingsVisible)}
        >
          <PanelRight />
        </Button>
      </ButtonGroup>
    </header>
  )
}
