import { useEffect, useState } from "react"
import NumberFlow from "@number-flow/react"
import { FLOW_TIMING } from "@/lib/flow-motion"

/** Let the surrounding indicator open before rolling its first value into view. */
export function AnimatedCount({
  value,
  suffix,
  entranceDelay = 0,
}: {
  value: number
  suffix?: string
  entranceDelay?: number
}) {
  const [entered, setEntered] = useState(entranceDelay === 0)
  useEffect(() => {
    if (!entranceDelay) return
    const timer = window.setTimeout(() => setEntered(true), entranceDelay)
    return () => window.clearTimeout(timer)
  }, [entranceDelay])
  return (
    <NumberFlow
      value={entered ? value : 0}
      suffix={suffix}
      locales="en-US"
      format={{ useGrouping: false }}
      transformTiming={FLOW_TIMING}
      spinTiming={FLOW_TIMING}
      opacityTiming={{ duration: 220, easing: "ease-out" }}
    />
  )
}
