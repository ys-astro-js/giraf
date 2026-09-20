import type { ComponentProps } from "react"
import { useReactFlow, useStore, type FitViewOptions } from "@xyflow/react"
import { Minus, Plus, Scan } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

export function WorkflowToolButton({
  label,
  tooltipSide = "right",
  ...props
}: Omit<ComponentProps<typeof Button>, "title" | "aria-label"> & {
  label: string
  tooltipSide?: ComponentProps<typeof TooltipContent>["side"]
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Button {...props} />}
        aria-label={label}
        data-slot="button"
      />
      <TooltipContent side={tooltipSide}>{label}</TooltipContent>
    </Tooltip>
  )
}

const defaultFitOptions = { padding: 0.2, maxZoom: 1 }
export function WorkflowZoomControls({
  orientation = "vertical",
  fitOptions = defaultFitOptions,
}: {
  orientation?: "horizontal" | "vertical"
  fitOptions?: FitViewOptions
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const canZoomIn = useStore((state) => state.transform[2] < state.maxZoom)
  const canZoomOut = useStore((state) => state.transform[2] > state.minZoom)
  const side = orientation === "vertical" ? "right" : "top"
  const zoomInButton = (
    <WorkflowToolButton
      variant="outline"
      size="icon-sm"
      tooltipSide={side}
      label="확대"
      disabled={!canZoomIn}
      onClick={() => zoomIn()}
    >
      <Plus />
    </WorkflowToolButton>
  )
  const zoomOutButton = (
    <WorkflowToolButton
      variant="outline"
      size="icon-sm"
      tooltipSide={side}
      label="축소"
      disabled={!canZoomOut}
      onClick={() => zoomOut()}
    >
      <Minus />
    </WorkflowToolButton>
  )
  return (
    <ButtonGroup orientation={orientation} aria-label="화면 배율">
      {orientation === "horizontal" ? zoomOutButton : zoomInButton}
      <WorkflowToolButton
        variant="outline"
        size="icon-sm"
        tooltipSide={side}
        label="화면 맞춤"
        onClick={() => fitView(fitOptions)}
      >
        <Scan />
      </WorkflowToolButton>
      {orientation === "horizontal" ? zoomInButton : zoomOutButton}
    </ButtonGroup>
  )
}
