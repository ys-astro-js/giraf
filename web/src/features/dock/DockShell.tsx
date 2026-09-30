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
import { PANELS, type PanelDefinition, type PanelId } from "./panels"
import {
  beginWindowDrag,
  endWindowDrag,
  loadLayout,
  restoreWindow,
  saveLayout,
  syncDock,
  useDock,
  windowMoved,
  type Edge,
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

/** Windows minimized toward one edge, restored by a click. */
function MinimizedStrip({ edge }: { edge: Edge }) {
  const minimized = useDock((state) => state.minimized)
  const items = minimized.filter((item) => item.edge === edge)
  if (!items.length) return null
  return (
    <nav className="dock-strip" data-edge={edge} aria-label="최소화한 창">
      <ToolbarGroup label="최소화한 창" size="sm">
        {items.map((item) => {
          const Icon = PANELS[item.component as PanelId]?.icon
          return (
            <ToolbarButton
              key={item.id}
              label={item.title}
              tooltipSide={
                edge === "left" ? "right" : edge === "right" ? "left" : "top"
              }
              onClick={() => restoreWindow(item.id)}
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
  api.onDidMovePanel(() => {
    windowMoved()
    syncDock()
  })
  api.onDidMaximizedGroupChange(syncDock)
  // A tab dropped where nothing docks it floats at the drop point.
  api.onWillDragPanel((event) => {
    const target = event.nativeEvent.target
    if (!(target instanceof HTMLElement)) return
    beginWindowDrag(event.panel)
    target.addEventListener("dragend", endWindowDrag, { once: true })
  })
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
      {header}
      <div className="dock-body">
        <MinimizedStrip edge="left" />
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
        <MinimizedStrip edge="right" />
      </div>
      <MinimizedStrip edge="bottom" />
    </SidebarProvider>
  )
}
