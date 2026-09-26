import { useEffect, useRef, useState } from "react"
import { Redo2, Undo2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import type { EditEntry } from "@/lib/edit-history"

type Props = {
  past: EditEntry[]
  future: EditEntry[]
  disabled: boolean
  onUndo: (steps?: number) => void
  onRedo: (steps?: number) => void
}

function HistoryButton({ direction, entries, disabled, onRestore }: {
  direction: "undo" | "redo"
  entries: EditEntry[]
  disabled: boolean
  onRestore: (steps?: number) => void
}) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const held = useRef(false)
  const clear = () => clearTimeout(timer.current)
  useEffect(() => () => clearTimeout(timer.current), [])
  const label = direction === "undo" ? "실행 취소" : "다시 실행"
  const Icon = direction === "undo" ? Undo2 : Redo2
  const unavailable = disabled || !entries.length
  return (
    <DropdownMenu open={open && !unavailable} onOpenChange={next => { if (!next) setOpen(false) }}>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" />}
        disabled={unavailable}
        aria-label={label}
        title={`${label} (${direction === "undo" ? "⌘/Ctrl+Z" : "⌘/Ctrl+Shift+Z"}) — 길게 누르거나 ↓ 키로 이력 선택`}
        style={{ touchAction: "none" }}
        onPointerDown={event => {
          event.preventBaseUIHandler()
          if (event.button !== 0 || unavailable) return
          clear()
          held.current = false
          timer.current = setTimeout(() => { held.current = true; setOpen(true) }, 500)
        }}
        onPointerUp={clear}
        onPointerLeave={clear}
        onPointerCancel={() => { clear(); held.current = true }}
        onContextMenu={event => { event.preventDefault(); clear(); held.current = true; setOpen(true) }}
        onClick={event => {
          event.preventBaseUIHandler()
          clear()
          if (!held.current && !open) onRestore()
          held.current = false
        }}
        onKeyDown={event => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            event.preventBaseUIHandler()
            setOpen(true)
          }
          if (event.key === "Enter" || event.key === " ") event.preventBaseUIHandler()
        }}
      >
        <Icon />
      </DropdownMenuTrigger>
      <DropdownMenuContent aria-label={`${label} 이력`}>
        <DropdownMenuGroup>
          {[...entries].reverse().map((entry, index) => (
            <DropdownMenuItem key={index} onClick={() => { onRestore(index + 1); setOpen(false) }}>
              <span className="text-muted-foreground tabular-nums">{index + 1}</span>
              <span>{entry.label}</span>
              <span className="sr-only">까지 {label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function EditHistoryControls({ past, future, disabled, onUndo, onRedo }: Props) {
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      const target = event.target
      if (disabled || event.defaultPrevented || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [role='textbox'], [role='dialog'], [role='alertdialog']"))) return
      const key = event.key.toLowerCase()
      if (key !== "z" && !(key === "y" && event.ctrlKey && !event.metaKey)) return
      event.preventDefault()
      if (event.shiftKey || key === "y") { if (future.length) onRedo() }
      else if (past.length) onUndo()
    }
    window.addEventListener("keydown", handleKey)
    return () => window.removeEventListener("keydown", handleKey)
  }, [disabled, past.length, future.length, onUndo, onRedo])
  return <ButtonGroup aria-label="편집 이력" className="ml-2 shrink-0">
    <HistoryButton direction="undo" entries={past} disabled={disabled} onRestore={onUndo} />
    <HistoryButton direction="redo" entries={future} disabled={disabled} onRestore={onRedo} />
  </ButtonGroup>
}
