import { useSyncExternalStore, type MouseEvent } from "react"
import type { IDockviewPanelHeaderProps } from "dockview-react"
import { Lock, LockOpen, X } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PANELS, type PanelId } from "./panels"
import { closeTab, toggleLock, useDock, type WindowParams } from "./store"

/** Tab buttons act without activating or dragging the tab under them. */
const own = (action: () => void) => ({
  onPointerDown: (event: MouseEvent) => event.stopPropagation(),
  onMouseDown: (event: MouseEvent) => event.stopPropagation(),
  onClick: (event: MouseEvent) => {
    event.stopPropagation()
    action()
  },
})

/**
 * A tab: one view in a window. It carries what acts on that view alone,
 * the follow-selection lock and close; the window pill acts on them all.
 */
export function DockTab({
  api,
  containerApi,
  params,
}: IDockviewPanelHeaderProps) {
  const definition = PANELS[api.component as PanelId]
  const Icon = definition?.icon
  const locked = !!(params as WindowParams | undefined)?.locked
  const title = useSyncExternalStore(
    (change) => {
      const listener = api.onDidTitleChange(change)
      return () => listener.dispose()
    },
    () => api.title
  )
  useDock((state) => state.revision)
  const panel = () => containerApi.getPanel(api.id)
  return (
    <span className="dock-tab" data-locked={locked}>
      <Tooltip>
        <TooltipTrigger
          render={<span className="dock-tab-title" />}
          aria-label={title}
        >
          {Icon && <Icon aria-hidden="true" />}
          <span className="dock-tab-label">{title}</span>
        </TooltipTrigger>
        <TooltipContent>{title}</TooltipContent>
      </Tooltip>
      {definition?.follows && (
        <button
          type="button"
          className="dock-tab-button dock-tab-lock"
          aria-pressed={locked}
          aria-label={locked ? `${title} 잠금 해제` : `${title} 잠금`}
          title={locked ? "잠금 해제" : "선택을 따라가지 않도록 잠금"}
          {...own(() => {
            const target = panel()
            if (target) toggleLock(target)
          })}
        >
          {locked ? <Lock /> : <LockOpen />}
        </button>
      )}
      <button
        type="button"
        className="dock-tab-button dock-tab-close"
        aria-label={`${title} 닫기`}
        title="탭 닫기"
        {...own(() => {
          const target = panel()
          if (target) closeTab(target)
        })}
      >
        <X />
      </button>
    </span>
  )
}
