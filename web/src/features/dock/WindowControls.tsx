import { useLayoutEffect, useState } from "react"
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
import { startWindowDrag } from "./drag"
import { WindowSlot } from "./WindowToolbar"
import { useBarOverflow } from "./bars"
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
 * The window's handle at the start of its toolbar row. Unlike the tab
 * controls beside it, it is always there, belongs to the window rather than
 * a tab, grows into close, minimize and maximize on hover, and moves the
 * window when dragged.
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
          <button
            type="button"
            className="window-pill-handle"
            aria-label="창 옮기기"
            title="끌어서 창 옮기기"
            onPointerDown={(event) => {
              if (event.button !== 0) return
              event.preventDefault()
              startWindowDrag(group, event.clientX, event.clientY)
            }}
          >
            <i />
            <i />
            <i />
          </button>
          <ToolbarItem hidden={!open}>
            <ToolbarButton label="창 닫기" onClick={() => closeWindow(group)}>
              <X />
            </ToolbarButton>
          </ToolbarItem>
          <ToolbarItem hidden={!open}>
            <ToolbarButton
              label="창 최소화"
              onClick={() => minimizeWindow(group)}
            >
              <Minus />
            </ToolbarButton>
          </ToolbarItem>
          <ToolbarItem hidden={!open}>
            <ToolbarButton
              label={maximized ? "원래 크기로" : "창 최대화"}
              onClick={() => toggleMaximized(group)}
            >
              {maximized ? <Minimize2 /> : <Maximize2 />}
            </ToolbarButton>
          </ToolbarItem>
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
        // The row less the pill, the title's stub and the gaps between them.
        room: () => {
          const style = getComputedStyle(row)
          const gap = parseFloat(style.columnGap) || 0
          const pill = row.querySelector(".window-pill")?.clientWidth ?? 0
          const title = row.querySelector(".window-title") ? TITLE_STUB : 0
          return row.clientWidth - pill - title - gap * 3
        },
      }
    },
    true,
    slot
  )
  useLayoutEffect(() => {
    useBarOverflow.setState({ [id]: overflow.context })
  }, [id, overflow.context])
  return (
    <div className="window-toolbar">
      <WindowPill group={props.group} active={props.isGroupActive} />
      <WindowSlot owner={id} slot="title" className="window-title-slot" />
      <WindowSlot
        owner={id}
        slot="top"
        className="window-toolbar-slot"
        onElement={setSlot}
      />
      <ToolbarCluster edge="end" className="window-overflow">
        <ToolbarSpacer />
        <ToolbarOverflowMenu overflow={overflow} />
      </ToolbarCluster>
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
