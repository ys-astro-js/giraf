import type { ComponentProps } from "react"
import { useReactFlow, useStore, type FitViewOptions } from "@xyflow/react"
import { Minus, Plus, Scan } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
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
    <ToolbarButton
      label={straight ? "곡선 연결선으로 변경" : "직선 연결선으로 변경"}
      onClick={onClick}
      disabled={disabled}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d={straight ? "M4 18C16 18 8 6 20 6" : "M4 18H12V6H20"} />
      </svg>
    </ToolbarButton>
  )
}

/** Zoom always reads out, fit, in, left to right. */
export function WorkflowZoomControls({
  fitOptions = defaultFitOptions,
}: {
  fitOptions?: FitViewOptions
}) {
  const { zoomIn, zoomOut, fitView } = useReactFlow()
  const canZoomIn = useStore((state) => state.transform[2] < state.maxZoom)
  const canZoomOut = useStore((state) => state.transform[2] > state.minZoom)
  return (
    <ToolbarGroup label="화면 배율">
      <ToolbarButton label="축소" disabled={!canZoomOut} onClick={() => zoomOut()}>
        <Minus />
      </ToolbarButton>
      <ToolbarButton label="화면 맞춤" onClick={() => fitView(fitOptions)}>
        <Scan />
      </ToolbarButton>
      <ToolbarButton label="확대" disabled={!canZoomIn} onClick={() => zoomIn()}>
        <Plus />
      </ToolbarButton>
    </ToolbarGroup>
  )
}
