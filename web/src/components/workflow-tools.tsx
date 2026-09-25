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
export function WorkflowEdgeStyleButton({ straight, onClick, disabled = false }: { straight: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <WorkflowToolButton variant="outline" size="icon-sm"
      label={straight ? "곡선 연결선으로 변경" : "직선 연결선으로 변경"}
      onClick={onClick}
      disabled={disabled}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={straight ? "M4 18C16 18 8 6 20 6" : "M4 18H12V6H20"} />
      </svg>
    </WorkflowToolButton>
  )
}

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
