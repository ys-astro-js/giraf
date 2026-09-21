import { useEffect, useState, type ReactNode } from "react"
import { FLOW_TIMING } from "@/lib/flow-motion"
import { cn } from "@/lib/utils"

/** Keep the departing content until the incoming content has taken its place. */
export function StatusTransition({
  transitionKey,
  children,
  className,
}: {
  transitionKey: string
  children: ReactNode
  className?: string
}) {
  const [snapshot, setSnapshot] = useState({
    key: transitionKey,
    content: children,
  })
  const [departing, setDeparting] = useState<{
    key: string
    content: ReactNode
  }>()
  if (snapshot.content !== children || snapshot.key !== transitionKey) {
    if (snapshot.key !== transitionKey) setDeparting(snapshot)
    setSnapshot({ key: transitionKey, content: children })
  }
  useEffect(() => {
    if (!departing) return
    const timer = window.setTimeout(
      () => setDeparting(undefined),
      FLOW_TIMING.duration
    )
    return () => window.clearTimeout(timer)
  }, [departing])
  return (
    <div
      className={cn("status-transition", className)}
      data-transitioning={!!departing}
    >
      {departing && (
        <div
          key={`out:${departing.key}`}
          className="status-transition-layer status-transition-out"
          aria-hidden="true"
          inert
        >
          {departing.content}
        </div>
      )}
      <div
        key={transitionKey}
        className="status-transition-layer status-transition-in"
      >
        {children}
      </div>
    </div>
  )
}
