import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"
import { AnimatedCount } from "@/components/animated-count"
import { TextFlow } from "@/components/text-flow"
import { StatusTransition } from "@/components/status-transition"
import {
  FolderOpen,
  ChevronRight,
  LoaderCircle,
  CirclePause,
  CircleCheck,
  CircleAlert,
  CircleStop,
  Play,
  Square,
  PanelLeft,
  PanelRight,
  PanelBottom,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useSidebar } from "@/components/ui/sidebar"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
  ToolbarMorph,
} from "@/components/toolbar"
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
const COMPLETION_HOLD_MS = 3000

type Props = {
  historyControls?: React.ReactNode
  diagnostics?: React.ReactNode
  workflowSelector?: React.ReactNode
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
  const { open, openMobile, isMobile, toggleSidebar } = useSidebar()
  const sidebarVisible = isMobile ? openMobile : open
  const status = props.executionStatus
  const completedKey =
    status?.state === "completed"
      ? `${status.executionId ?? status.name}:completed`
      : undefined
  const [dismissedCompletion, setDismissedCompletion] = useState<string>()
  useEffect(() => {
    if (!completedKey) return
    const timeout = window.setTimeout(
      () => setDismissedCompletion(completedKey),
      COMPLETION_HOLD_MS
    )
    return () => window.clearTimeout(timeout)
  }, [completedKey])
  const showExecution =
    status &&
    (status.state === "running" ||
      status.state === "waiting" ||
      (status.state === "completed" && completedKey !== dismissedCompletion))
  const diagnosticsRef = useRef<HTMLDivElement>(null)
  const [diagnosticsWidth, setDiagnosticsWidth] = useState(0)
  useLayoutEffect(() => {
    const element = diagnosticsRef.current
    if (!element) return
    const observer = new ResizeObserver(() =>
      setDiagnosticsWidth(element.getBoundingClientRect().width)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const progressPercent =
    status?.progressFraction !== undefined &&
    Number.isFinite(status.progressFraction)
      ? Math.round(Math.max(0, Math.min(1, status.progressFraction)) * 100)
      : undefined
  const StatusIcon = status ? statusIcons[status.state] : LoaderCircle
  return (
    <header className="workbench-toolbar" aria-label="도구 막대">
      <ToolbarCluster className="toolbar-leading" edge="start">
        <ToolbarGroup label="사이드바">
          <ToolbarButton
            label={sidebarVisible ? "사이드바 닫기" : "사이드바 열기"}
            onClick={toggleSidebar}
          >
            <PanelLeft />
          </ToolbarButton>
        </ToolbarGroup>
        <ToolbarGroup label="일괄 실행">
          <ToolbarMorph
            variant={props.workflowBusy ? "ghost" : "default"}
            active={props.workflowBusy}
            idle={<Play />}
            activeContent={<Square />}
            label="일괄 실행"
            activeLabel="중단"
            onClick={props.workflowBusy ? props.onCancel : props.onRun}
            disabled={!props.workflowBusy && props.runDisabled}
          />
        </ToolbarGroup>
        {props.historyControls}
      </ToolbarCluster>
      <div className="toolbar-center">
        <div
          className="toolbar-status text-sm"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <div
            className="toolbar-status-content glass-surface"
            data-state={showExecution ? status.state : "idle"}
            title={showExecution ? status.label : undefined}
          >
            {status && progressPercent !== undefined && (
              <span
                className="toolbar-status-fill"
                role={showExecution ? "progressbar" : undefined}
                aria-hidden={!showExecution}
                aria-label={`${status.name} 진행률`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                style={{
                  transform: `scaleX(${progressPercent / 100})`,
                  opacity: showExecution ? 1 : 0,
                }}
              />
            )}
            <StatusTransition
              transitionKey={showExecution ? "execution" : "idle"}
              className="toolbar-mode-transition"
            >
              <div className="toolbar-status-transition">
                {!showExecution && (
                  <>
                    {props.loading ? (
                      <Skeleton
                        aria-label="폴더 불러오는 중"
                        className="h-6 w-32"
                      />
                    ) : (
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Button
                              variant="ghost"
                              size="xs"
                              className="min-w-0 text-sm"
                              disabled={!props.ready}
                            />
                          }
                          onClick={props.onFolder}
                          disabled={!props.ready}
                          aria-label="폴더 열기"
                        >
                          <FolderOpen
                            data-icon="inline-start"
                            className="size-4"
                          />
                          {
                            <span className="truncate">
                              {props.folder.split("/").filter(Boolean).at(-1) ||
                                props.folder ||
                                "폴더 열기"}
                            </span>
                          }
                        </TooltipTrigger>
                        <TooltipContent className="max-w-80 break-all">
                          {props.folder || "폴더 열기"}
                        </TooltipContent>
                      </Tooltip>
                    )}
                    <ChevronRight
                      aria-hidden="true"
                      className="size-3.5 shrink-0"
                    />
                    {props.loading ? (
                      <Skeleton
                        aria-label="워크플로우 불러오는 중"
                        className="h-6 w-32"
                      />
                    ) : (
                      props.workflowSelector
                    )}
                  </>
                )}
                {showExecution ? (
                  <>
                    <div className="toolbar-task-transition">
                      <div className="toolbar-task-content">
                        <StatusIcon
                          aria-hidden="true"
                          className={cn(
                            "size-4 shrink-0",
                            status.state === "running" &&
                              "motion-safe:animate-spin"
                          )}
                        />
                        <TextFlow
                          value={status.name}
                          shimmer={status.state === "running"}
                          className="toolbar-status-name font-medium"
                        />
                        <span className="sr-only">{status.label}</span>
                      </div>
                    </div>
                    {status.progress && (
                      <span
                        className="toolbar-status-progress text-muted-foreground tabular-nums"
                        aria-label={status.progress}
                      >
                        <span aria-hidden="true">
                          {status.progressCount !== undefined ? (
                            <>
                              <AnimatedCount value={status.progressCount} />
                              {status.progressTotal !== undefined ? (
                                <>
                                  /
                                  <AnimatedCount value={status.progressTotal} />
                                </>
                              ) : (
                                "개 작업"
                              )}
                            </>
                          ) : (
                            status.progress
                          )}
                        </span>
                      </span>
                    )}
                  </>
                ) : (
                  <span className="sr-only">실행 대기</span>
                )}
              </div>
            </StatusTransition>
          </div>
        </div>
        <div
          className="toolbar-diagnostics"
          style={{ width: diagnosticsWidth ? diagnosticsWidth + 8 : 0 }}
        >
          <div ref={diagnosticsRef} className="toolbar-diagnostics-content">
            {props.diagnostics}
          </div>
        </div>
      </div>
      <ToolbarCluster className="toolbar-panels" edge="end">
        <ToolbarGroup label="패널 표시">
          <ToolbarButton
            label={props.trayOpen ? "하단 패널 닫기" : "하단 패널 열기"}
            aria-pressed={props.trayOpen}
            onClick={() => props.onTray(!props.trayOpen)}
          >
            <PanelBottom />
          </ToolbarButton>
          <ToolbarButton
            label={props.settingsVisible ? "설정 패널 닫기" : "설정 패널 열기"}
            aria-pressed={props.settingsVisible}
            onClick={() => props.onSettings(!props.settingsVisible)}
          >
            <PanelRight />
          </ToolbarButton>
        </ToolbarGroup>
      </ToolbarCluster>
    </header>
  )
}
