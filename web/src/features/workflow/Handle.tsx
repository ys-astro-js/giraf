import {
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ComponentProps,
} from "react"
import { Handle as FlowHandle, useNodeId, useConnection } from "@xyflow/react"
import { Ban } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { flowPortColors } from "@/lib/workflow-flow"

import { WorkflowContext } from "./context"
function ConnectionHandleAnchor({
  onClick,
  ...props
}: ComponentProps<typeof FlowHandle>) {
  // Tooltip's click-to-dismiss handler would override React Flow's click connector.
  void onClick
  return <FlowHandle {...props} />
}
export function Handle(props: ComponentProps<typeof FlowHandle>) {
  const { validateConnection, edges } = useContext(WorkflowContext)!
  const from = useConnection((state) =>
    state.inProgress ? state.fromHandle : null
  )
  // Handles receive their node id from React Flow's enclosing node context.
  const nodeId = useNodeId()!
  const colors = flowPortColors(edges, nodeId, props.type, props.id)
  const portFill =
    colors.length === 1
      ? colors[0]
      : colors.length > 1
        ? `conic-gradient(${colors.map((color, index) => `${color} ${(index * 100) / colors.length}% ${((index + 1) * 100) / colors.length}%`).join(", ")})`
        : undefined
  const near = useConnection(
    (state) =>
      state.inProgress &&
      state.toHandle?.nodeId === nodeId &&
      state.toHandle?.id === props.id &&
      state.toHandle?.type === props.type
  )
  const [hovered, setHovered] = useState(false)
  const feedback = useMemo(() => {
    if (!from || from.type === props.type) return null
    const source = from.type === "source" ? from : { nodeId, id: props.id }
    const target = from.type === "target" ? from : { nodeId, id: props.id }
    return validateConnection({
      source: source.nodeId,
      sourceHandle: source.id ?? null,
      target: target.nodeId,
      targetHandle: target.id ?? null,
    })
  }, [from, nodeId, props.id, props.type, validateConnection])
  const isOrigin =
    from?.nodeId === nodeId && from.id === props.id && from.type === props.type
  const state = feedback
    ? feedback.valid
      ? "available"
      : "unavailable"
    : isOrigin
      ? "origin"
      : from
        ? "irrelevant"
        : undefined
  return (
    <Tooltip open={!!feedback && !feedback.valid && (near || hovered)}>
      <TooltipTrigger
        render={
          <ConnectionHandleAnchor
            {...props}
            data-connection-state={state}
            data-highlighted={!!portFill}
            aria-label={`${props["aria-label"] ?? "포트"}${feedback ? `: ${feedback.valid ? "연결 가능" : "연결 불가"}` : ""}`}
            title={from ? undefined : props.title}
            style={
              {
                ...props.style,
                "--workflow-port-fill": portFill,
                ...(feedback ? { pointerEvents: "all" } : {}),
              } as CSSProperties
            }
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => setHovered(false)}
            onFocus={() => setHovered(true)}
            onBlur={() => setHovered(false)}
          >
            {feedback && !feedback.valid ? (
              <>
                <span className="connection-port-symbol" aria-hidden="true">
                  <Ban />
                </span>
                {props.children && props.type === "source" && (
                  <span className="connection-port-name">{props.children}</span>
                )}
              </>
            ) : (
              props.children
            )}
          </ConnectionHandleAnchor>
        }
      />
      <TooltipContent
        className="pointer-events-none"
        side={props.type === "target" ? "left" : "right"}
      >
        <span className="connection-port-feedback" role="status">
          {!feedback?.valid && feedback?.message}
        </span>
      </TooltipContent>
    </Tooltip>
  )
}
