import { useEffect, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import {
  Lock,
  LockOpen,
  Maximize2,
  Minimize2,
  PanelRightDashed,
  PictureInPicture2,
  X,
} from "lucide-react"
import { LinearBlur } from "progressive-blur"
import type {
  DockviewGroupPanel,
  IDockviewHeaderActionsProps,
  IDockviewPanel,
} from "dockview-react"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
  ToolbarItem,
  ToolbarOverflowMenu,
  ToolbarSpacer,
} from "@/components/toolbar"
import { WindowSlot, WindowToolbar } from "./WindowToolbar"
import { useBarOverflow } from "./bars"
import { CANVAS, isDocked } from "./layout"
import { morphBars } from "./morph"
import { useToolbarOverflow } from "@/components/toolbar-overflow"
import {
  attachWindow,
  closeWindow,
  detachWindow,
  toggleLock,
  toggleMaximized,
  useDock,
  type WindowParams,
} from "./store"

/**
 * The window's own controls at the start of its top bar: close, maximize,
 * and float out of the column or dock back into it. Shown small at rest so
 * they say what they do, grown to toolbar size over the title on hover.
 */
export function WindowPill({
  group,
  active,
}: {
  group: DockviewGroupPanel
  active: boolean
}) {
  const maximized = useDock((state) => state.maximized === group.id)
  useDock((state) => state.revision)
  const docked = isDocked(group)
  return (
    <span className="window-pill" data-active={active}>      <ToolbarCluster edge="start" className="window-pill-cluster">
        <ToolbarGroup label="창 조작">
          <ToolbarButton label="창 닫기" onClick={() => closeWindow(group)}>
            <X />
          </ToolbarButton>
          <ToolbarButton
            label={maximized ? "최대화 끝내기" : "최대화"}
            onClick={() => toggleMaximized(group)}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </ToolbarButton>
          <ToolbarButton
            label={docked ? "분리" : "오른쪽에 붙이기"}
            onClick={() => (docked ? detachWindow : attachWindow)(group)}
          >
            {docked ? <PictureInPicture2 /> : <PanelRightDashed />}
          </ToolbarButton>
        </ToolbarGroup>
      </ToolbarCluster>
    </span>
  )
}

/** Following tabs can stop following the selection and keep their view. */
export function LockControl({ panel }: { panel: IDockviewPanel }) {
  const locked = !!(panel.params as WindowParams | undefined)?.locked
  return (
    <WindowToolbar placement="leading">
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

/**
 * A window's top bar row, above its tab bar: the pill, the shown tab's
 * leading controls, title, then its toolbar. The canvas has the row without
 * the pill (`controls`), floating over it. The bar's empty space drags the
 * window.
 */
export function WindowBar({
  group,
  owner = group.id,
  active,
  controls = true,
}: {
  group: DockviewGroupPanel
  /** Whose bar slots these are (see `barOwner`). */
  owner?: string
  active: boolean
  controls?: boolean
}) {
  useDock((state) => state.revision)
  const id = owner
  // The toolbar slot is the room the tab's toolbar has; past it, groups
  // marked overflow go to the menu at the end of the bar.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const overflow = useToolbarOverflow(() => {
    const content = slot
    const row = content?.parentElement
    if (!content || !row) return null
    return {
      content,
      container: row,
      // The row less the pill, leading controls, the title's stub and the
      // gaps between what the row shows.
      room: () => {
        const style = getComputedStyle(row)
        const gap = parseFloat(style.columnGap) || 0
        const pill = row.querySelector(".window-pill")?.clientWidth ?? 0
        const leading =
          row.querySelector(".window-leading-slot")?.clientWidth ?? 0
        // The title keeps a stub before the toolbar gives way (dock.css).
        const title = row.querySelector(".window-title:not([data-inactive])")
          ? parseFloat(style.getPropertyValue("--window-title-stub"))
          : 0
        const items = [...row.children].filter(
          (child) => getComputedStyle(child).display !== "none"
        ).length
        // The leading slot gives back its gap (see dock.css).
        return row.clientWidth - pill - leading - title - gap * (items - 2)
      },
    }
  }, slot)
  useLayoutEffect(() => {
    useBarOverflow.setState({ [id]: overflow.context })
  }, [id, overflow.context])
  // A newly shown tab morphs the window's bars from the last tab's.
  useEffect(() => {
    const listener = group.api.onDidActivePanelChange(() => morphBars(group))
    return () => listener.dispose()
  }, [group])
  // The bar itself, which holds this row and the tab bar; content-rich
  // windows paint a progressive blur behind it.
  const [bar, setBar] = useState<HTMLElement | null>(null)
  return (
    <div
      className="window-toolbar"
      ref={(row) =>
        setBar(
          row?.closest<HTMLElement>(".dv-tabs-and-actions-container") ?? null
        )
      }
    >
      {bar &&
        createPortal(
          <LinearBlur
            className="window-bar-blur"
            side="top"
            strength={24}
            steps={6}
            tint="var(--window-bar)"
          />,
          bar
        )}
      {controls && <WindowPill group={group} active={active} />}
      <WindowSlot
        owner={id}
        slot="leading"
        className="window-toolbar-slot window-leading-slot"
      />
      <WindowSlot owner={id} slot="title" className="window-title-slot" />
      <WindowSlot
        owner={id}
        slot="top"
        className="window-toolbar-slot"
        onElement={setSlot}
      />
      {/* The overflow menu joins the tab's toolbar, just before a primary
          action at the very end (see dock.css). */}
      {slot &&
        createPortal(
          <ToolbarCluster edge="end" className="window-overflow">
            <ToolbarSpacer />
            <ToolbarOverflowMenu overflow={overflow} />
          </ToolbarCluster>,
          slot
        )}
    </div>
  )
}

/** The window bar as dockview's header actions; the canvas has its own. */
export function WindowTopBar(props: IDockviewHeaderActionsProps) {
  if (props.panels.some((panel) => panel.id === CANVAS)) return null
  return <WindowBar group={props.group} active={props.isGroupActive} />
}
