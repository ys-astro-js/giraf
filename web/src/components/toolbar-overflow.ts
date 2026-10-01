import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react"
import type { OverflowEntry } from "@/components/toolbar-context"

export type ToolbarOverflow = ReturnType<typeof useToolbarOverflow>

/** Where a toolbar's content is and how much width it may take. */
export type OverflowMeasure = {
  /** Holds the items; its scroll width is what they need. */
  content: HTMLElement
  /** Its width (or `room`, if given) is what the items may take. */
  container: HTMLElement
  /** Width available with nothing sent away, when it differs from the container's. */
  room?: () => number
}

/**
 * Measures toolbar content against the room it has: past that width it
 * collapses, sending `overflow` groups to the menu, and it expands again once
 * the room is as wide as the content last needed.
 */
export function useToolbarOverflow(
  measure: () => OverflowMeasure | null,
  /** Measures again when this changes, e.g. the element measured. */
  target?: unknown
) {
  const [collapsed, setCollapsed] = useState(false)
  const needed = useRef(0)
  const items = useRef(new Map<string, OverflowEntry>())
  const [listed, setListed] = useState<[string, OverflowEntry][]>([])
  useLayoutEffect(() => {
    const target = measure()
    if (!target) return
    const { content, container } = target
    const room = target.room ?? (() => container.clientWidth)
    const check = () => {
      const width = room()
      setCollapsed((was) => {
        if (!was && content.scrollWidth > width + 0.5) {
          needed.current = content.scrollWidth
          return true
        }
        return was && width < needed.current
      })
    }
    // The room, the content and each of its items: content can grow while
    // the room stays capped, and items come and go (a window's tabs).
    const observer = new ResizeObserver(check)
    const watch = () => {
      observer.disconnect()
      observer.observe(container)
      observer.observe(content)
      for (const item of content.children) observer.observe(item)
      check()
    }
    watch()
    const mutations = new MutationObserver(watch)
    mutations.observe(content, { childList: true })
    return () => {
      observer.disconnect()
      mutations.disconnect()
    }
    // Measured per target; the observers follow later changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target])
  const set = useCallback((key: string, entry: OverflowEntry | null) => {
    const before = items.current.get(key)
    if (entry) items.current.set(key, entry)
    else items.current.delete(key)
    // Only what the menu shows re-lists it; handlers are read on click.
    const changed =
      !before !== !entry ||
      before?.label !== entry?.label ||
      before?.disabled !== entry?.disabled ||
      before?.pressed !== entry?.pressed
    if (changed) setListed([...items.current])
  }, [])
  const context = useMemo(() => ({ collapsed, set }), [collapsed, set])
  const entries = collapsed ? listed : []
  const run = (key: string) => items.current.get(key)?.onClick?.()
  return { context, entries, run }
}
