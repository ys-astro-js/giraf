import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react"
import {
  DockviewReact,
  type DockviewApi,
  type DockviewTheme,
  type IDockviewPanelProps,
} from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import { SidebarProvider } from "@/components/ui/sidebar"
import { PanelContext } from "./context"
import { DockTab } from "./DockTab"
import { LockControl, WindowBar, WindowTopBar } from "./WindowControls"
import { WindowSlot } from "./WindowToolbar"
import { recordBars } from "./morph"
import { DisplayWatcher } from "@/features/viewer/DisplayPanel"
import { PANELS, type PanelDefinition } from "./panels"
import {
  endColumnResize,
  layoutDock,
  loadLayout,
  startColumnResize,
  useDock,
  watchDock,
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
    const [canvas, setCanvas] = useState(!!definition.canvas)
    const content = (
      <div
        className="dock-window"
        data-kind={definition.kind}
        data-canvas={canvas || undefined}
      >
        <Content />
        {/* The canvas has no header; its bar floats over it instead. */}
        {panel && definition.kind === "canvas" && (
          <div className="canvas-bar">
            <WindowBar
              group={panel.group}
              owner={props.api.id}
              active
              controls={false}
            />
          </div>
        )}
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

function ready(dock: DockviewApi, root: HTMLElement | null) {
  useDock.setState({ api: dock })
  if (root) dock.layout(root.clientWidth, root.clientHeight)
  loadLayout(dock)
  watchDock(dock)
}

/**
 * The workbench below the app's toolbar: the workflow canvas, the column of
 * node and viewer windows, and any floating windows over them.
 */
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
  // dockview's own resizing lays the grid out in proportions; the dock is
  // laid out here instead, so the column keeps its width.
  useEffect(() => {
    const element = rootRef.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) =>
      layoutDock(entry.contentRect.width, entry.contentRect.height)
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  function pointerDown(event: PointerEvent) {
    const target = event.target as HTMLElement
    // The column's divider: the column takes the width it is dragged to.
    if (target.closest(".dv-sash")) {
      startColumnResize()
      window.addEventListener("pointerup", endColumnResize, { once: true })
      return
    }
    // A tab about to be shown: its window's bars morph from the current ones.
    const id = target.closest<HTMLElement>(".dock-tab")?.dataset.panelId
    const panel = id ? useDock.getState().api?.getPanel(id) : undefined
    if (panel && panel.group.activePanel !== panel) recordBars(panel.group)
  }
  return (
    <SidebarProvider className="giraf-app" open>
      <DisplayWatcher />
      {header}
      <div className="dock-body">
        <div
          className="dock-root"
          ref={rootRef}
          onPointerDownCapture={pointerDown}
        >
          <DockviewReact
            components={components}
            defaultTabComponent={DockTab}
            prefixHeaderActionsComponent={WindowTopBar}
            watermarkComponent={() => null}
            theme={theme}
            dndStrategy="html5"
            disableTabsOverflowList
            disableAutoResizing
            floatingGroupDragHandle="tabbar"
            onReady={(event) => ready(event.api, rootRef.current)}
          />
        </div>
      </div>
    </SidebarProvider>
  )
}
