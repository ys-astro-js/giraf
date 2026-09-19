import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
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
  const [sidebarWidth, setSidebarWidth] = useState(256)
  const mobile = useIsMobile()
  const library = usePanelRef(),
    history = usePanelRef(),
    inspector = usePanelRef()
  useEffect(() => {
    if (!mobile) {
      if (props.libraryOpen) library.current?.expand()
      else library.current?.collapse()
    }
  }, [props.libraryOpen, mobile, library])
  useEffect(() => {
    if (props.trayOpen) history.current?.expand()
    else history.current?.collapse()
  }, [props.trayOpen, mobile, history])
  useEffect(() => {
    if (!mobile) {
      if (props.inspectorOpen) inspector.current?.expand()
      else inspector.current?.collapse()
    }
  }, [props.inspectorOpen, mobile, inspector])
  const editor = mobile ? (
    props.mobilePanel === "detail" ? (
      props.inspector
    ) : (
      props.canvas
    )
  ) : (
    <ResizablePanelGroup orientation="horizontal" id="editor-panels">
      <ResizablePanel id="canvas" minSize={220} defaultSize="60%">
        {props.canvas}
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="캔버스와 설정 크기 조절" className={!props.inspectorOpen ? "hidden" : undefined} />
      <ResizablePanel id="inspector" panelRef={inspector} collapsible collapsedSize={0} minSize={300} defaultSize={props.inspectorOpen ? "40%" : 0}
        onResize={(size, _, previous) => { if (previous) props.onInspectorOpen(size.inPixels > 0) }}>
        {props.inspector}
      </ResizablePanel>
    </ResizablePanelGroup>
  )
  const workspace = (
    <ResizablePanelGroup orientation="vertical" id="workspace-panels">
      <ResizablePanel id="editor" minSize={200} defaultSize="75%">
        {editor}
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="실행 기록 높이 조절" className={!props.trayOpen ? "hidden" : undefined} />
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
  const content = (
    <SidebarInset className="workbench-inset">
      {props.header}
      {props.navigation}
      <div className="workbench-panels">{workspace}</div>
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
            minSize={224}
            maxSize={360}
            defaultSize={props.libraryOpen ? sidebarWidth : 0}
            onResize={(size, _, previous) => {
              if (size.inPixels > 0) setSidebarWidth(size.inPixels)
              if (previous) props.onLibraryOpen(size.inPixels > 0)
            }}
          />
          <ResizableHandle withHandle aria-label="사이드바 너비 조절" />
          <ResizablePanel id="workspace" minSize={520}>
            {content}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
    </SidebarProvider>
  )
}
