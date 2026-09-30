import {
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react"
import { usePanelRef } from "react-resizable-panels"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { PANELS } from "@/features/panels/registry"
import { useLayout } from "@/features/workbench/layout-store"
import {
  readPanelLayout,
  savePanelLayout,
  SIDEBAR_MAX_WIDTH,
} from "@/lib/panel-layout"

const Library = PANELS.library.component,
  Workflow = PANELS.workflow.component,
  Inspector = PANELS.inspector.component,
  History = PANELS.history.component

/** Places the workbench panels: library, workflow over history, inspector. */
export function WorkbenchShell({ header }: { header: ReactNode }) {
  const libraryOpen = useLayout((state) => state.open.library)
  const inspectorOpen = useLayout((state) => state.open.inspector)
  const trayOpen = useLayout((state) => state.open.history)
  const setOpen = useLayout((state) => state.setOpen)
  const [savedLayout] = useState(readPanelLayout)
  const [sidebarWidth, setSidebarWidth] = useState(
    savedLayout.libraryWidth || 256
  )
  const libraryWidth = useRef(savedLayout.libraryWidth || 256)
  const inspectorWidth = useRef(savedLayout.inspectorWidth || 384)
  const library = usePanelRef(),
    history = usePanelRef(),
    inspector = usePanelRef()
  useEffect(() => {
    if (libraryOpen) library.current?.resize(libraryWidth.current)
    else library.current?.collapse()
  }, [libraryOpen, library])
  useEffect(() => {
    if (trayOpen) history.current?.expand()
    else history.current?.collapse()
  }, [trayOpen, history])
  useEffect(() => {
    if (inspectorOpen) inspector.current?.resize(inspectorWidth.current)
    else inspector.current?.collapse()
  }, [inspectorOpen, inspector])
  const workspace = (
    <ResizablePanelGroup orientation="vertical" id="workspace-panels">
      <ResizablePanel id="editor" minSize={200} defaultSize="75%">
        <Workflow />
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label="실행 기록 높이 조절"
        className={!trayOpen ? "hidden" : undefined}
      />
      <ResizablePanel
        id="history"
        panelRef={history}
        collapsible
        collapsedSize={0}
        minSize={160}
        maxSize="60%"
        defaultSize={trayOpen ? 240 : 0}
        onResize={(size, _, previous) => {
          if (previous) setOpen("history", size.inPixels > 0)
        }}
      >
        <History />
      </ResizablePanel>
    </ResizablePanelGroup>
  )
  return (
    <SidebarProvider
      className="giraf-app"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      open={libraryOpen}
      onOpenChange={(open) => setOpen("library", open)}
      data-tray={trayOpen}
    >
      {header}
      <div className="workbench-body">
        <Library />
        <ResizablePanelGroup orientation="horizontal" id="library-panels">
          <ResizablePanel
            id="library"
            panelRef={library}
            collapsible
            collapsedSize={0}
            minSize={180}
            maxSize={SIDEBAR_MAX_WIDTH}
            groupResizeBehavior="preserve-pixel-size"
            defaultSize={libraryOpen ? savedLayout.libraryWidth || 256 : 0}
            onResize={(size, _, previous) => {
              if (size.inPixels > 0) {
                libraryWidth.current = size.inPixels
                setSidebarWidth(size.inPixels)
                if (previous) savePanelLayout({ libraryWidth: size.inPixels })
              }
              if (previous) setOpen("library", size.inPixels > 0)
            }}
          />
          <ResizableHandle withHandle aria-label="사이드바 너비 조절" />
          <ResizablePanel id="workspace" minSize={inspectorOpen ? 520 : 220}>
            <SidebarInset className="workbench-inset">
              <div className="workbench-panels">
                <ResizablePanelGroup
                  orientation="horizontal"
                  id="editor-panels"
                >
                  <ResizablePanel id="canvas" minSize={220}>
                    {workspace}
                  </ResizablePanel>
                  <ResizableHandle
                    withHandle
                    aria-label="캔버스와 설정 크기 조절"
                    className={!inspectorOpen ? "hidden" : undefined}
                  />
                  <ResizablePanel
                    id="inspector"
                    panelRef={inspector}
                    collapsible
                    collapsedSize={0}
                    minSize={300}
                    maxSize={SIDEBAR_MAX_WIDTH}
                    groupResizeBehavior="preserve-pixel-size"
                    defaultSize={
                      inspectorOpen ? savedLayout.inspectorWidth || 384 : 0
                    }
                    onResize={(size, _, previous) => {
                      if (size.inPixels > 0) {
                        inspectorWidth.current = size.inPixels
                        if (previous)
                          savePanelLayout({ inspectorWidth: size.inPixels })
                      }
                      if (previous) setOpen("inspector", size.inPixels > 0)
                    }}
                  >
                    <Inspector />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </div>
            </SidebarInset>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </SidebarProvider>
  )
}
