import { useEffect, useLayoutEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Maximize2, Minimize2, Minus, X } from "lucide-react"
import type {
  DockviewGroupPanel,
  IDockviewHeaderActionsProps,
} from "dockview-react"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
  ToolbarItem,
  ToolbarOverflowMenu,
  ToolbarSpacer,
} from "@/components/toolbar"
import { WindowSlot } from "./WindowToolbar"
import { APP, slotKey, useBarOverflow, useSlots } from "./bars"
import { morphBars } from "./morph"
import { useToolbarOverflow } from "@/components/toolbar-overflow"
import { PANELS, type PanelId } from "./panels"
import {
  closeWindow,
  minimizeWindow,
  restoreTab,
  restoreWindow,
  toggleMaximized,
  useDock,
} from "./store"

/**
 * The window's own controls at the start of its top bar: close, minimize and
 * maximize, shown small at rest so they say what they do, and grown to
 * toolbar size over the title on hover. The bar's empty space moves the
 * window, so the pill needs no handle of its own.
 */
export function WindowPill({
  group,
  active,
}: {
  group: DockviewGroupPanel
  active: boolean
}) {
  const [open, setOpen] = useState(false)
  const maximized = useDock((state) => state.maximized === group.id)
  return (
    <span
      className="window-pill"
      data-active={active}
      data-open={open}
      onPointerEnter={() => setOpen(true)}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node))
          setOpen(false)
      }}
    >
      <ToolbarCluster edge="start" className="window-pill-cluster">
        <ToolbarGroup label="창 조작">
          <ToolbarButton label="창 닫기" onClick={() => closeWindow(group)}>
            <X />
          </ToolbarButton>
          <ToolbarButton
            label="창 최소화"
            onClick={() => minimizeWindow(group)}
          >
            <Minus />
          </ToolbarButton>
          <ToolbarButton
            label={maximized ? "원래 크기로" : "창 최대화"}
            onClick={() => toggleMaximized(group)}
          >
            {maximized ? <Minimize2 /> : <Maximize2 />}
          </ToolbarButton>
        </ToolbarGroup>
      </ToolbarCluster>
    </span>
  )
}

/** The title keeps this much width before the toolbar gives way (see dock.css). */
const TITLE_STUB = 72

/**
 * A window's top bar row, above its tab bar: the pill, the shown tab's
 * title, then its toolbar. The bar's empty space drags the window.
 */
export function HeaderControls(props: IDockviewHeaderActionsProps) {
  useDock((state) => state.revision)
  const id = props.group.id
  // The toolbar slot is the room the tab's toolbar has; past it, groups
  // marked overflow go to the menu at the end of the bar.
  const [slot, setSlot] = useState<HTMLDivElement | null>(null)
  const overflow = useToolbarOverflow(
    () => {
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
          const title = row.querySelector(".window-title:not([data-inactive])")
            ? TITLE_STUB
            : 0
          const items = [...row.children].filter(
            (child) => getComputedStyle(child).display !== "none"
          ).length
          // The leading slot gives back its gap (see dock.css).
          return row.clientWidth - pill - leading - title - gap * (items - 2)
        },
      }
    },
    true,
    slot
  )
  useLayoutEffect(() => {
    useBarOverflow.setState({ [id]: overflow.context })
  }, [id, overflow.context])
  const fullscreen = useDock((state) => state.fullscreen === id)
  const appPill = useSlots((slots) => slots[slotKey(APP, "pill")])
  // Fullscreen, the window's toolbar sits in the app's bar with room to
  // spare, so it has no overflow menu.
  const overflowSlot = fullscreen ? undefined : slot
  const pill = <WindowPill group={props.group} active={props.isGroupActive} />
  // A newly shown tab morphs the window's bars from the last tab's.
  useEffect(() => {
    const listener = props.group.api.onDidActivePanelChange(() =>
      morphBars(props.group)
    )
    return () => listener.dispose()
  }, [props.group])
  return (
    <div className="window-toolbar">
      {/* Fullscreen, the window's controls join the app's top bar. */}
      {fullscreen && appPill ? createPortal(pill, appPill) : pill}
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
      {overflowSlot &&
        createPortal(
          <ToolbarCluster edge="end" className="window-overflow">
            <ToolbarSpacer />
            <ToolbarOverflowMenu overflow={overflow} />
          </ToolbarCluster>,
          overflowSlot
        )}
    </div>
  )
}

/**
 * Minimized windows and closed built-in tabs, as a group in the top
 * toolbar; it slides in and out with the toolbar's own motion.
 */
export function WindowTray() {
  const minimized = useDock((state) => state.minimized)
  const stowed = useDock((state) => state.stowed)
  const dock = useDock((state) => state.api)
  const items = [
    ...minimized.flatMap((item) => {
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
    }),
    ...stowed.map((item) => ({
      key: item.id,
      label: item.title,
      component: item.component,
      restore: () => restoreTab(item.id),
    })),
  ]
  return (
    <ToolbarGroup label="최소화한 창" hidden={!items.length}>
      {items.map((item) => {
        const Icon = PANELS[item.component as PanelId]?.icon
        return (
          <ToolbarItem key={item.key}>
            <ToolbarButton label={item.label} onClick={item.restore}>
              {Icon && <Icon />}
            </ToolbarButton>
          </ToolbarItem>
        )
      })}
    </ToolbarGroup>
  )
}
