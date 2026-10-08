import {
  Ban,
  Check,
  CircleDashed,
  CircleHelp,
  CircleX,
  Clock3,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react"

export function StatusIcon({ severity, state }: { severity?: string; state?: string }) {
  if (severity === "error") return <CircleX aria-hidden="true" />
  if (severity) return <TriangleAlert aria-hidden="true" />
  if (state === "running" || state === "queued")
    return <LoaderCircle className="node-running-icon" aria-hidden="true" />
  if (state === "completed") return <Check aria-hidden="true" />
  if (state === "waiting") return <Clock3 aria-hidden="true" />
  if (state === "failed") return <CircleX aria-hidden="true" />
  if (state === "cancelled") return <Ban aria-hidden="true" />
  if (state) return <CircleHelp aria-hidden="true" />
  return <CircleDashed aria-hidden="true" />
}
