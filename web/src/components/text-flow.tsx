import { StatusTransition } from "@/components/status-transition"
import { cn } from "@/lib/utils"

/** Roll a complete line through one fixed window, like a single NumberFlow digit. */
export function TextFlow({
  value,
  shimmer = false,
  className,
}: {
  value: string
  shimmer?: boolean
  className?: string
}) {
  return (
    <StatusTransition
      transitionKey={value}
      className={cn("text-flow", className)}
    >
      <span
        title={value}
        className={cn(
          "text-flow-line",
          shimmer && "shimmer-duration-2500 motion-safe:shimmer"
        )}
      >
        {value}
      </span>
    </StatusTransition>
  )
}
