import { useSyncExternalStore } from "react"
import type { IDockviewPanelHeaderProps } from "dockview-react"
import { Lock } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { PANELS, type PanelId } from "./panels"
import type { WindowParams } from "./store"

/**
 * A window tab: the segmented pill of the existing sidebar. Tool windows
 * show their symbol, and their name while the strip has room.
 */
export function DockTab({ api, params }: IDockviewPanelHeaderProps) {
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
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="dock-tab" />} aria-label={title}>
        {locked && <Lock className="dock-tab-lock" aria-label="잠김" />}
        {Icon && <Icon aria-hidden="true" />}
        <span className="dock-tab-label">{title}</span>
      </TooltipTrigger>
      <TooltipContent>{title}</TooltipContent>
    </Tooltip>
  )
}
