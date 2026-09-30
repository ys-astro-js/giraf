import {
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { Check, Menu } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  useToolbarOverflow,
  type ToolbarOverflow,
} from "@/components/toolbar-overflow"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  OverflowContext,
  OverflowGroupContext,
  ToolbarContext,
  useToolbarButtonSize,
  type OverflowEntry,
  type ToolbarEdge,
  type ToolbarPlacement,
  type ToolbarSize,
} from "@/components/toolbar-context"

/**
 * Floating toolbar grammar: capsule groups that share one glass background.
 * A cluster pins its groups to one edge, and that edge decides where
 * appearing controls come from and where disappearing controls go.
 */
export function ToolbarCluster({
  edge = "start",
  placement,
  size,
  joined = false,
  overflow = false,
  className,
  children,
  ...props
}: ComponentProps<"div"> & {
  edge?: ToolbarEdge
  placement?: ToolbarPlacement
  size?: ToolbarSize
  /** Every group reads as one capsule, spacers or not. */
  joined?: boolean
  /**
   * When the cluster outgrows its container, groups marked `overflow` leave
   * for a menu at the trailing end, and come back once there is room.
   */
  overflow?: boolean
}) {
  const parent = useContext(ToolbarContext)
  // Without its own overflow, a cluster passes on an enclosing one's.
  const outer = useContext(OverflowContext)
  const context = {
    edge,
    placement: placement ?? parent.placement,
    size: size ?? parent.size,
  }
  const ref = useRef<HTMLDivElement>(null)
  const registry = useToolbarOverflow(
    () =>
      ref.current?.parentElement
        ? { content: ref.current, container: ref.current.parentElement }
        : null,
    overflow
  )
  return (
    <ToolbarContext.Provider value={context}>
      <OverflowContext.Provider value={overflow ? registry.context : outer}>
        <div
          ref={ref}
          data-slot="toolbar-cluster"
          data-edge={edge}
          data-joined={joined}
          data-overflow={overflow || undefined}
          className={cn("toolbar-cluster", className)}
          {...props}
        >
          {children}
          {overflow && (
            <>
              <ToolbarSpacer />
              <ToolbarOverflowMenu overflow={registry} />
            </>
          )}
        </div>
      </OverflowContext.Provider>
    </ToolbarContext.Provider>
  )
}

/** The menu holding what an overflowing toolbar sent away; hidden until then. */
export function ToolbarOverflowMenu({
  overflow,
}: {
  overflow: ToolbarOverflow
}) {
  const { placement } = useContext(ToolbarContext)
  return (
    <ToolbarGroup label="더 보기" hidden={!overflow.entries.length}>
      <DropdownMenu>
        <DropdownMenuTrigger render={<ToolbarButton label="더 보기" />}>
          <Menu />
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          side={placement === "top" ? "bottom" : "top"}
        >
          <DropdownMenuGroup>
            {overflow.entries.map(([key, entry]) => (
              <DropdownMenuItem
                key={key}
                disabled={entry.disabled}
                onClick={() => overflow.run(key)}
              >
                {entry.icon}
                {entry.label}
                {entry.pressed && <Check className="ml-auto" />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </ToolbarGroup>
  )
}

/**
 * Hidden groups stay mounted so they can leave visibly: beside a neighbor
 * they slide behind it, alone they materialize in place.
 */
export function ToolbarGroup({
  label,
  hidden: ownHidden = false,
  overflow = false,
  size,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "hidden"> & {
  label: string
  hidden?: boolean
  /** Less important: the first to leave for the overflow menu. */
  overflow?: boolean
  size?: ToolbarSize
}) {
  const parent = useContext(ToolbarContext)
  const registry = useContext(OverflowContext)
  const id = useId()
  const movable = overflow && !!registry
  const hidden = ownHidden || (movable && registry.collapsed)
  const group = useMemo(
    () => (movable ? { id, shown: !ownHidden } : null),
    [movable, id, ownHidden]
  )
  const groupSize = size ?? parent.size
  return (
    <OverflowGroupContext.Provider value={group}>
      <ToolbarContext.Provider value={{ ...parent, size: groupSize }}>
        <div
          className="toolbar-slot"
          data-hidden={hidden}
          data-edge={parent.edge}
          inert={hidden}
          aria-hidden={hidden || undefined}
        >
          <div
            role="group"
            aria-label={label}
            data-slot="toolbar-group"
            data-size={groupSize}
            className={cn("toolbar-group", className)}
            {...props}
          >
            {children}
          </div>
        </div>
      </ToolbarContext.Provider>
    </OverflowGroupContext.Provider>
  )
}

/**
 * Space between toolbar items, after SwiftUI's ToolbarSpacer. Items with
 * nothing between them join into one capsule; a fixed spacer sets them a
 * standard gap apart; a flexible spacer takes the free space, so items on
 * either side of it go to the leading and trailing ends (two of them center
 * what sits between).
 */
export function ToolbarSpacer({ flexible = false }: { flexible?: boolean }) {
  return (
    <span
      className="toolbar-spacer"
      data-kind={flexible ? "flexible" : "fixed"}
      aria-hidden="true"
    />
  )
}

/** A control of the same kind joining or leaving an existing group. */
export function ToolbarItem({
  hidden = false,
  children,
}: {
  hidden?: boolean
  children: ReactNode
}) {
  const { edge } = useContext(ToolbarContext)
  const group = useContext(OverflowGroupContext)
  const own = useMemo(
    () => group && { ...group, shown: group.shown && !hidden },
    [group, hidden]
  )
  return (
    <OverflowGroupContext.Provider value={own}>
      <span
        className="toolbar-item"
        data-hidden={hidden}
        data-edge={edge}
        inert={hidden}
        aria-hidden={hidden || undefined}
      >
        <span className="toolbar-item-content">{children}</span>
      </span>
    </OverflowGroupContext.Provider>
  )
}

export function ToolbarButton({
  label,
  tooltipSide,
  variant = "ghost",
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "title" | "aria-label" | "size"> & {
  label: string
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"]
}) {
  const { placement } = useContext(ToolbarContext)
  const size = useToolbarButtonSize()
  useOverflowEntry({
    label,
    icon: props.children,
    onClick: props.onClick as (() => void) | undefined,
    disabled: !!props.disabled,
    pressed: props["aria-pressed"] === true || props["aria-pressed"] === "true",
  })
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={variant}
            size={size}
            className={cn("toolbar-button", className)}
            {...props}
          />
        }
        aria-label={label}
        data-slot="button"
      />
      <TooltipContent
        side={tooltipSide ?? (placement === "top" ? "bottom" : "top")}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Lists a button in its cluster's overflow menu while its group can go there. */
function useOverflowEntry(entry: OverflowEntry) {
  const registry = useContext(OverflowContext)
  const group = useContext(OverflowGroupContext)
  const id = useId()
  const key = group && `${group.id}${id}`
  useLayoutEffect(() => {
    if (registry && key) registry.set(key, group.shown ? entry : null)
  })
  useLayoutEffect(
    () => () => {
      if (registry && key) registry.set(key, null)
    },
    [registry, key]
  )
}

/**
 * One control that changes role keeps its place and reshapes, e.g. a text
 * "선택" becoming a close icon. The new face enters from the cluster edge.
 */
export function ToolbarMorph({
  active,
  idle,
  activeContent,
  label,
  activeLabel,
  variant = "ghost",
  className,
  style,
  ...props
}: Omit<
  ComponentProps<typeof Button>,
  "title" | "aria-label" | "size" | "children"
> & {
  active: boolean
  idle: ReactNode
  activeContent: ReactNode
  label: string
  activeLabel: string
}) {
  const { edge, placement } = useContext(ToolbarContext)
  const size = useToolbarButtonSize()
  const idleRef = useRef<HTMLSpanElement>(null)
  const activeRef = useRef<HTMLSpanElement>(null)
  const [widths, setWidths] = useState<[number, number]>()
  useLayoutEffect(() => {
    const faces = [idleRef.current, activeRef.current]
    if (!faces[0] || !faces[1]) return
    const measure = () =>
      setWidths([faces[0]!.offsetWidth, faces[1]!.offsetWidth])
    measure()
    const observer = new ResizeObserver(measure)
    faces.forEach((face) => observer.observe(face!))
    return () => observer.disconnect()
  }, [])
  const face = (content: ReactNode) =>
    typeof content === "string" ? "text" : "icon"
  return (
    <Tooltip disabled={face(active ? activeContent : idle) === "text"}>
      <TooltipTrigger
        data-slot="button"
        render={
          <Button
            variant={variant}
            size={size}
            className={cn("toolbar-morph", className)}
            data-active={active}
            data-edge={edge}
            data-size={size}
            aria-label={active ? activeLabel : label}
            style={{ ...style, width: widths?.[active ? 1 : 0] }}
            {...props}
          >
            <span
              ref={idleRef}
              className="toolbar-morph-face"
              data-face="idle"
              data-kind={face(idle)}
              aria-hidden="true"
            >
              {idle}
            </span>
            <span
              ref={activeRef}
              className="toolbar-morph-face"
              data-face="active"
              data-kind={face(activeContent)}
              aria-hidden="true"
            >
              {activeContent}
            </span>
          </Button>
        }
      />
      <TooltipContent side={placement === "top" ? "bottom" : "top"}>
        {active ? activeLabel : label}
      </TooltipContent>
    </Tooltip>
  )
}

/** Plain text that belongs to a group, such as a zoom percentage. */
export function ToolbarText({ className, ...props }: ComponentProps<"span">) {
  return <span className={cn("toolbar-text", className)} {...props} />
}
