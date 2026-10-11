import type { ReactElement } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { FieldIssue } from "@/lib/diagnostics"

/** The control of a field with a problem: aria-invalid, in the warning colour for a warning. */
export const invalidProps = (issue?: FieldIssue) =>
  issue ? { "aria-invalid": true as const, "data-severity": issue.severity } : {}

/** A field with a problem shows the diagnostic's message on hover. */
export function IssueTooltip({ issue, children }: { issue?: FieldIssue; children: ReactElement }) {
  if (!issue) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent className="flex-col items-start whitespace-pre-line">{issue.message}</TooltipContent>
    </Tooltip>
  )
}
