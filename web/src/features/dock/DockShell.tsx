import { useMemo, type ReactNode } from "react"
import {
  DockviewReact,
  type DockviewApi,
  type DockviewTheme,
  type IDockviewPanelProps,
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { PanelContext } from "./context"
import { DockTab } from "./DockTab"
import { HeaderControls } from "./WindowControls"
import { DisplayWatcher } from "@/features/viewer/DisplayPanel"
import { PANELS, type PanelDefinition, type PanelId } from "./panels"
import {
  loadLayout,
  restoreTab,
  restoreWindow,
  saveLayout,
  syncDock,
  useDock,
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

function frame(definition: PanelDefinition) {
  const Content = definition.component
  return function DockWindow(props: IDockviewPanelProps) {
    const panel = props.containerApi.getPanel(props.api.id)
    const content = (
      <div className="dock-window" data-surface={definition.surface}>
        <Content />
      </div>
    )
    if (!panel) return content
    return (
      <PanelContext value={{ panel, params: props.params as WindowParams }}>
        {content}
      </PanelContext>
    )
  }
}

/**
 * Minimized windows and closed built-in tabs wait in a floating toolbar at
 * the bottom of the workbench, only while there is something in it.
 */
function WindowTray() {
  const minimized = useDock((state) => state.minimized)
  const stowed = useDock((state) => state.stowed)
  const dock = useDock((state) => state.api)
  const windows = minimized.flatMap((item) => {
    const group = dock?.getGroup(item.group)
    const panel = group?.activePanel ?? group?.panels[0]
    if (!group || !panel) return []
    return [
      {
        key: item.group,
        label: group.panels.map((p) => p.title).join(", "),
        component: panel.view.contentComponent,
        restore: () => restoreWindow(item.group),
      },
    ]
  })
  const tabs = stowed.map((item) => ({
    key: item.id,
    label: item.title,
    component: item.component,
    restore: () => restoreTab(item.id),
  }))
  const items = [...windows, ...tabs]
  if (!items.length) return null
  return (
    <nav className="dock-tray" aria-label="최소화한 창">
      <ToolbarGroup label="최소화한 창">
        {items.map((item) => {
          const Icon = PANELS[item.component as PanelId]?.icon
          return (
            <ToolbarButton
              key={item.key}
              label={item.label}
              onClick={item.restore}
            >
              {Icon && <Icon />}
            </ToolbarButton>
          )
        })}
      </ToolbarGroup>
    </nav>
  )
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
  return (
    <SidebarProvider className="giraf-app" open>
      <DisplayWatcher />
      {header}
      <div className="dock-body">
        <div className="dock-root">
          <DockviewReact
            components={components}
            defaultTabComponent={DockTab}
            prefixHeaderActionsComponent={HeaderControls}
            watermarkComponent={() => null}
            theme={theme}
            dndStrategy="html5"
            disableTabsOverflowList
            floatingGroupDragHandle="tabbar"
            onReady={(event) => ready(event.api)}
          />
        </div>
        <WindowTray />
      </div>
    </SidebarProvider>
  )
}
