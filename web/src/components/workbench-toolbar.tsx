import {
  FolderOpen,
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

type Props = {
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
  return (
    <header className="workbench-toolbar" aria-label="도구 막대">
      <div className="toolbar-leading">
        <SidebarTrigger size="icon" aria-label="사이드바 열기 또는 닫기" />
        {props.loading ? (
          <div role="status" aria-label="폴더 불러오는 중" aria-busy="true">
            <Skeleton aria-hidden="true" className="toolbar-folder-wide h-9 w-32" />
            <Skeleton aria-hidden="true" className="toolbar-folder-compact size-9" />
          </div>
        ) : [false, true].map((compact) => (
          <Tooltip key={String(compact)}>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size={compact ? "icon" : "default"}
                  className={
                    compact
                      ? "toolbar-folder-compact"
                      : "toolbar-folder-wide max-w-48 min-w-0"
                  }
                  disabled={!props.ready}
                />
              }
              onClick={props.onFolder}
              disabled={!props.ready}
              aria-label="폴더 열기"
            >
              <FolderOpen data-icon={compact ? undefined : "inline-start"} />
              {!compact && (
                <span className="truncate">
                  {props.folder.split("/").filter(Boolean).at(-1) ||
                    props.folder ||
                    "폴더 열기"}
                </span>
              )}
            </TooltipTrigger>
            <TooltipContent className="max-w-80 break-all">
              {props.folder || "폴더 열기"}
            </TooltipContent>
          </Tooltip>
        ))}
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
      <ButtonGroup className="toolbar-panels" aria-label="패널 표시">
        <Button
          size="icon"
          variant="ghost"
          aria-label={props.trayOpen ? "하단 패널 닫기" : "하단 패널 열기"}
          title={props.trayOpen ? "하단 패널 닫기" : "하단 패널 열기"}
          onClick={() => props.onTray(!props.trayOpen)}
        >
          <PanelBottom />
        </Button>
        <Button
          size="icon"
          variant="ghost"
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
