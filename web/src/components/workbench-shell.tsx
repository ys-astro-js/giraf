import {
  useEffect,
  useState,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react"
import { usePanelRef } from "react-resizable-panels"
import {
  SidebarProvider,
  SidebarInset,
  useSidebar,
} from "@/components/ui/sidebar"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { useIsMobile } from "@/hooks/use-mobile"

import {
  readPanelLayout,
  savePanelLayout,
  SIDEBAR_MAX_WIDTH,
} from "@/lib/panel-layout"

type Props = {
  header: ReactNode
  navigation: ReactNode
  library: ReactNode
  canvas: ReactNode
  inspector: ReactNode
  history: ReactNode
  libraryOpen: boolean
  onLibraryOpen: (value: boolean) => void
  inspectorOpen: boolean
  onInspectorOpen: (value: boolean) => void
  trayOpen: boolean
  onTrayOpen: (value: boolean) => void
  mobilePanel: string
  selection: string
}
function CloseMobileSidebar({ selection }: { selection: string }) {
  const { setOpenMobile } = useSidebar()
  useEffect(() => {
    setOpenMobile(false)
  }, [selection, setOpenMobile])
  return null
}
export function WorkbenchShell(props: Props) {
  const [savedLayout] = useState(readPanelLayout)
  const [sidebarWidth, setSidebarWidth] = useState(
    savedLayout.libraryWidth || 256
  )
  const libraryWidth = useRef(savedLayout.libraryWidth || 256)
  const inspectorWidth = useRef(savedLayout.inspectorWidth || 384)
  useEffect(() => {
    savePanelLayout({
      libraryOpen: props.libraryOpen,
      inspectorOpen: props.inspectorOpen,
    })
  }, [props.libraryOpen, props.inspectorOpen])
  const mobile = useIsMobile()
  const library = usePanelRef(),
    history = usePanelRef(),
    inspector = usePanelRef()
  useEffect(() => {
    if (!mobile) {
      if (props.libraryOpen) library.current?.resize(libraryWidth.current)
      else library.current?.collapse()
    }
  }, [props.libraryOpen, mobile, library])
  useEffect(() => {
    if (props.trayOpen) history.current?.expand()
    else history.current?.collapse()
  }, [props.trayOpen, mobile, history])
  useEffect(() => {
    if (!mobile) {
      if (props.inspectorOpen) inspector.current?.resize(inspectorWidth.current)
      else inspector.current?.collapse()
    }
  }, [props.inspectorOpen, mobile, inspector])
  const workspace = (
    <ResizablePanelGroup orientation="vertical" id="workspace-panels">
      <ResizablePanel id="editor" minSize={200} defaultSize="75%">
        {mobile && props.mobilePanel === "detail"
          ? props.inspector
          : props.canvas}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label="실행 기록 높이 조절"
        className={!props.trayOpen ? "hidden" : undefined}
      />
      <ResizablePanel
        id="history"
        panelRef={history}
        collapsible
        collapsedSize={0}
        minSize={160}
        maxSize="60%"
        defaultSize={props.trayOpen ? 240 : 0}
        onResize={(size, _, previous) => {
          if (previous) props.onTrayOpen(size.inPixels > 0)
        }}
      >
        {props.history}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
  const editor = mobile ? (
    workspace
  ) : (
    <ResizablePanelGroup orientation="horizontal" id="editor-panels">
      <ResizablePanel id="canvas" minSize={220}>
        {workspace}
      </ResizablePanel>
      <ResizableHandle
        withHandle
        aria-label="캔버스와 설정 크기 조절"
        className={!props.inspectorOpen ? "hidden" : undefined}
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
          props.inspectorOpen ? savedLayout.inspectorWidth || 384 : 0
        }
        onResize={(size, _, previous) => {
          if (size.inPixels > 0) {
            inspectorWidth.current = size.inPixels
            if (previous) savePanelLayout({ inspectorWidth: size.inPixels })
          }
          if (previous) props.onInspectorOpen(size.inPixels > 0)
        }}
      >
        {props.inspector}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
  const content = (
    <SidebarInset className="workbench-inset">
      <div className="workbench-panels">{editor}</div>
    </SidebarInset>
  )
  return (
    <SidebarProvider
      className="giraf-app"
      style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}
      open={props.libraryOpen}
      onOpenChange={props.onLibraryOpen}
      data-tray={props.trayOpen}
      data-panel={props.mobilePanel}
    >
      <CloseMobileSidebar selection={props.selection} />
      {props.header}
      {props.navigation}
      <div className="workbench-body">
        {props.library}
        {mobile ? (
          content
        ) : (
          <ResizablePanelGroup orientation="horizontal" id="library-panels">
            <ResizablePanel
              id="library"
              panelRef={library}
              collapsible
              collapsedSize={0}
              minSize={180}
              maxSize={SIDEBAR_MAX_WIDTH}
              groupResizeBehavior="preserve-pixel-size"
              defaultSize={
                props.libraryOpen ? savedLayout.libraryWidth || 256 : 0
              }
              onResize={(size, _, previous) => {
                if (size.inPixels > 0) {
                  libraryWidth.current = size.inPixels
                  setSidebarWidth(size.inPixels)
                  if (previous) savePanelLayout({ libraryWidth: size.inPixels })
                }
                if (previous) props.onLibraryOpen(size.inPixels > 0)
              }}
            />
            <ResizableHandle withHandle aria-label="사이드바 너비 조절" />
            <ResizablePanel
              id="workspace"
              minSize={props.inspectorOpen ? 520 : 220}
            >
              {content}
            </ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>
    </SidebarProvider>
  )
}
