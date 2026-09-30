import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  DockviewReact,
  type DockviewApi,
  type DockviewTheme,
  type IDockviewPanel,
  type IDockviewPanelProps,
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import { SidebarProvider } from "@/components/ui/sidebar"
import { PanelContext } from "./context"
import { DockTab } from "./DockTab"
import { HeaderControls } from "./WindowControls"
import { WindowSlot, WindowToolbar } from "./WindowToolbar"
import { Lock, LockOpen } from "lucide-react"
import { ToolbarButton, ToolbarGroup, ToolbarItem } from "@/components/toolbar"
import { headerPointerDown } from "./drag"
import { DisplayWatcher } from "@/features/viewer/DisplayPanel"
import { PANELS, type PanelDefinition } from "./panels"
import {
  loadLayout,
  saveLayout,
  syncDock,
  toggleLock,
  type WindowParams,
} from "./store"
import "@/styles/workbench/dock.css"

const theme: DockviewTheme = {
  name: "giraf",
  className: "dockview-theme-giraf",
  gap: 0,
  dndOverlayMounting: "relative",
  dndPanelOverlay: "group",
}

/** Following tabs can stop following the selection and keep their view. */
function LockControl({ panel }: { panel: IDockviewPanel }) {
  const locked = !!(panel.params as WindowParams | undefined)?.locked
  return (
    <WindowToolbar placement="leading" className="window-lock-cluster">
      <ToolbarGroup label="탭">
        <ToolbarItem>
          <ToolbarButton
            label={locked ? "잠금 해제" : "선택을 따라가지 않도록 잠금"}
            aria-pressed={locked}
            className="window-lock"
            onClick={() => toggleLock(panel)}
          >
            {locked ? <Lock /> : <LockOpen />}
          </ToolbarButton>
        </ToolbarItem>
      </ToolbarGroup>
    </WindowToolbar>
  )
}

function frame(definition: PanelDefinition) {
  const Content = definition.component
  return function DockWindow(props: IDockviewPanelProps) {
    const panel = props.containerApi.getPanel(props.api.id)
    const [canvas, setCanvas] = useState(!!definition.canvas)
    const content = (
      <div
        className="dock-window"
        data-surface={definition.surface}
        data-canvas={canvas || undefined}
        data-scroll-under={definition.scrollUnder}
      >
        <Content />
        <WindowSlot
          owner={props.api.id}
          slot="bottom"
          className="window-bottom-bar"
        />
      </div>
    )
    if (!panel) return content
    return (
      <PanelContext
        value={{ panel, params: props.params as WindowParams, setCanvas }}
      >
        {content}
        {definition.follows && <LockControl panel={panel} />}
      </PanelContext>
    )
  }
}

function ready(api: DockviewApi) {
  loadLayout(api)
  let pending = 0
  api.onDidLayoutChange(() => {
    syncDock()
    window.clearTimeout(pending)
    pending = window.setTimeout(saveLayout, 300)
  })
  api.onDidActiveGroupChange(syncDock)
  api.onDidActivePanelChange(syncDock)
  api.onDidAddPanel(syncDock)
  api.onDidRemovePanel(syncDock)
  api.onDidMovePanel(syncDock)
  api.onDidAddGroup(syncDock)
  api.onDidRemoveGroup(syncDock)
}

/** The workbench: toolbar above dockable windows and minimized strips. */
export function DockShell({ header }: { header: ReactNode }) {
  const components = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(PANELS).map(([id, definition]) => [
          id,
          frame(definition),
        ])
      ),
    []
  )
  const rootRef = useRef<HTMLDivElement>(null)
  // Header drags start before dockview's own handlers see the pointer.
  useEffect(() => {
    const element = rootRef.current
    element?.addEventListener("pointerdown", headerPointerDown, true)
    return () =>
      element?.removeEventListener("pointerdown", headerPointerDown, true)
  }, [])
  return (
    <SidebarProvider className="giraf-app" open>
      <DisplayWatcher />
      {header}
      <div className="dock-body">
        <div className="dock-root" ref={rootRef}>
          <DockviewReact
            components={components}
            defaultTabComponent={DockTab}
            prefixHeaderActionsComponent={HeaderControls}
            watermarkComponent={() => null}
            theme={theme}
            dndStrategy="html5"
            disableTabsOverflowList
            // Windows move by their header (see drag.ts), not dockview drags.
            disableDnd
            floatingGroupDragHandle="titlebar"
            onReady={(event) => ready(event.api)}
          />
        </div>
      </div>
    </SidebarProvider>
  )
}
