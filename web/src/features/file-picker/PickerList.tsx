import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { cn } from "@/lib/utils"
import {
  clickHighlight,
  moveHighlight,
  type Highlight,
} from "@/lib/file-picker"

type ListContext = {
  highlight: Highlight
  order: string[]
  onHighlight: (next: Highlight) => void
  rows: RefObject<Map<string, { element: HTMLElement; activate?: () => void }>>
  /** The row the list is moving focus to itself, already highlighted. */
  moving: RefObject<string | null>
}
const Context = createContext<ListContext | null>(null)

/**
 * A list with one tab stop: arrows move the highlight (⇧ grows it), a click
 * highlights a row (⇧ for a range, ⌘/Ctrl to toggle), Enter and a double
 * click act on the row.
 */
export function PickerList({
  label,
  order,
  highlight,
  onHighlight,
  onKey,
  header,
  listRef,
  className,
  children,
}: {
  label: string
  /** Keys of the rows that take part in highlighting, top to bottom. */
  order: string[]
  highlight: Highlight
  onHighlight: (next: Highlight) => void
  /** Keys of the list's own: return true when handled. */
  onKey?: (event: KeyboardEvent<HTMLDivElement>) => boolean | void
  header?: ReactNode
  listRef?: RefObject<HTMLDivElement | null>
  className?: string
  children: ReactNode
}) {
  const rows = useRef(new Map<string, { element: HTMLElement; activate?: () => void }>())
  const moving = useRef<string | null>(null)
  const own = useRef<HTMLDivElement | null>(null)
  // When the focused row goes away (removed, or the list was replaced by
  // another folder), the focus stays in the list: on the highlighted row or
  // the first one. Leaving the list on purpose clears `holding`.
  const holding = useRef(false)
  useLayoutEffect(() => {
    if (!holding.current) return
    // Only focus that was lost (on the page or the dialog around the list),
    // never focus a key moved elsewhere, such as into a preview.
    const active = document.activeElement
    if (active && active !== document.body && !active.contains(own.current))
      return
    const target = highlight.focus && rows.current.get(highlight.focus)
    if (target) target.element.focus()
    else if (order.length) rows.current.get(order[0])?.element.focus()
    else own.current?.focus()
  })
  function show(next: Highlight) {
    onHighlight(next)
    moving.current = next.focus
    if (next.focus) rows.current.get(next.focus)?.element.focus()
    moving.current = null
  }
  return (
    <Context.Provider
      value={{ highlight, order, onHighlight, rows, moving }}
    >
      <div
        ref={(element) => {
          own.current = element
          if (listRef) listRef.current = element
        }}
        role="listbox"
        aria-label={label}
        aria-multiselectable="true"
        className={cn("picker-pane-list", className)}
        // With no row to focus, the list itself takes the one tab stop.
        tabIndex={order.length ? -1 : 0}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            holding.current = false
        }}
        onFocus={(event) => {
          holding.current = true
          if (event.target !== event.currentTarget || !order.length) return
          const first = highlight.focus ?? order[0]
          rows.current.get(first)?.element.focus()
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (onKey?.(event)) return
          const focus = highlight.focus
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            show(
              moveHighlight(
                highlight,
                order,
                event.key === "ArrowDown" ? 1 : -1,
                event.shiftKey
              )
            )
          } else if (event.key === "Home" || event.key === "End") {
            event.preventDefault()
            show(
              moveHighlight(
                { ...highlight, focus: null },
                order,
                event.key === "Home" ? 1 : -1,
                false
              )
            )
          } else if (event.key === "Enter" && focus) {
            event.preventDefault()
            rows.current.get(focus)?.activate?.()
          } else if (
            (event.metaKey || event.ctrlKey) &&
            event.code === "KeyA"
          ) {
            event.preventDefault()
            onHighlight({ ...highlight, selected: [...order] })
          }
        }}
      >
        {header}
        {children}
      </div>
    </Context.Provider>
  )
}

/** A row of a PickerList; `onActivate` runs on Enter and double click. */
export function PickerRow({
  id,
  onActivate,
  onClick,
  className,
  children,
  ...props
}: Omit<ComponentProps<"div">, "id"> & {
  id: string
  onActivate?: () => void
}) {
  const list = useContext(Context)!
  const highlighted = list.highlight.selected.includes(id)
  const stop =
    list.highlight.focus && list.order.includes(list.highlight.focus)
      ? list.highlight.focus === id
      : list.order[0] === id
  return (
    <div
      role="option"
      aria-selected={highlighted}
      data-highlighted={highlighted || undefined}
      tabIndex={stop ? 0 : -1}
      className={cn("picker-row", className)}
      ref={(element) => {
        if (element) list.rows.current.set(id, { element, activate: onActivate })
        else list.rows.current.delete(id)
      }}
      onFocus={(event) => {
        if (
          event.target === event.currentTarget &&
          list.moving.current !== id &&
          list.highlight.focus !== id
        )
          list.onHighlight({ ...list.highlight, focus: id })
      }}
      // ⇧click extends the highlight, never a text selection.
      onMouseDown={(event) => {
        if (event.shiftKey) event.preventDefault()
      }}
      onClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return
        // ⇧click kept the focus where it was (see onMouseDown).
        event.currentTarget.focus()
        list.onHighlight(
          clickHighlight(list.highlight, list.order, id, {
            shift: event.shiftKey,
            toggle: event.metaKey || event.ctrlKey,
          })
        )
        onClick?.(event)
      }}
      onDoubleClick={(event) => {
        if ((event.target as HTMLElement).closest("button")) return
        onActivate?.()
      }}
      {...props}
    >
      {children}
    </div>
  )
}
