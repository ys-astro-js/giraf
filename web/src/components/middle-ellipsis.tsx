import { useLayoutEffect, useRef, useState } from "react"
import { middleEllipsis } from "@/lib/middle-ellipsis"
import { cn } from "@/lib/utils"

export function MiddleEllipsis({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const element = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(text)
  useLayoutEffect(() => {
    const node = element.current
    if (!node) return
    const context = document.createElement("canvas").getContext("2d")
    if (!context) return
    const update = () => {
      const style = getComputedStyle(node)
      context.font = style.font
      context.letterSpacing = style.letterSpacing
      setVisible(
        middleEllipsis(
          text,
          node.clientWidth,
          (value) => context.measureText(value).width
        )
      )
    }
    const observer = new ResizeObserver(update)
    observer.observe(node)
    document.fonts.addEventListener("loadingdone", update)
    update()
    return () => {
      observer.disconnect()
      document.fonts.removeEventListener("loadingdone", update)
    }
  }, [text])
  return (
    <span
      ref={element}
      className={cn("min-w-0 flex-1 truncate", className)}
      title={text}
    >
      <span aria-hidden="true">{visible}</span>
      <span className="sr-only">{text}</span>
    </span>
  )
}
