import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ToolbarContext,
  useToolbarButtonSize,
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
  className,
  ...props
}: ComponentProps<"div"> & {
  edge?: ToolbarEdge
  placement?: ToolbarPlacement
  size?: ToolbarSize
  /** Adjacent groups read as one capsule, e.g. when space runs short. */
  joined?: boolean
}) {
  const parent = useContext(ToolbarContext)
  return (
    <ToolbarContext.Provider
      value={{
        edge,
        placement: placement ?? parent.placement,
        size: size ?? parent.size,
      }}
    >
      <div
        data-slot="toolbar-cluster"
        data-edge={edge}
        data-joined={joined}
        className={cn("toolbar-cluster", className)}
        {...props}
      />
    </ToolbarContext.Provider>
  )
}

/**
 * Hidden groups stay mounted so they can leave visibly: beside a neighbor
 * they slide behind it, alone they materialize in place.
 */
export function ToolbarGroup({
  label,
  hidden = false,
  size,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "hidden"> & {
  label: string
  hidden?: boolean
  size?: ToolbarSize
}) {
  const parent = useContext(ToolbarContext)
  const groupSize = size ?? parent.size
  return (
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
  return (
    <span
      className="toolbar-item"
      data-hidden={hidden}
      data-edge={edge}
      inert={hidden}
      aria-hidden={hidden || undefined}
    >
      <span className="toolbar-item-content">{children}</span>
    </span>
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
