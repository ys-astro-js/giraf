import { useEffect, useEffectEvent } from "react"
import { groupContents } from "@/lib/group-nesting"
import { activeJob } from "@/lib/queries"
import {
  activatesOnEnter,
  matchesShortcut,
  ownsKeys,
  shortcuts,
} from "@/lib/shortcuts"
import { runsAlone } from "@/lib/values"
import type { Workbench } from "@/features/workbench/useWorkbenchController"

/**
 * Enter on a focused control is that control's; on the selected node (or
 * nowhere in particular) it runs the node.
 */
function enterRunsSelected(target: EventTarget | null, selected: string) {
  if (!(target instanceof Element)) return true
  const node = target.closest<HTMLElement>(".react-flow__node")
  if (node)
    return (
      node.dataset.id === selected &&
      (target === node || !!target.closest(".node-heading"))
    )
  return !activatesOnEnter(target)
}

/**
 * The workbench's keyboard shortcuts, each doing what its button does and
 * held back when that button is disabled. The IRAF cursor session listens
 * first (capture) and claims its keys by preventing their default.
 */
export function useWorkbenchShortcuts(w: Workbench) {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      w.home !== false ||
      w.documentBusy ||
      ownsKeys(event.target)
    )
      return
    const { map, catalog } = w
    const task = map.tasks.find((t) => t.id === map.view.selected)
    const take = () => event.preventDefault()

    if (matchesShortcut(event, shortcuts.copy)) {
      // Selected text copies as text.
      const text = window.getSelection()
      if (text && !text.isCollapsed && text.toString().trim()) return
      if (task && w.copy([task.id])) take()
      return
    }
    if (matchesShortcut(event, shortcuts.paste)) {
      if (w.paste()) take()
      return
    }
    if (event.repeat) return
    if (matchesShortcut(event, shortcuts.addTask)) {
      take()
      if (catalog) w.setAddOpen(true)
      return
    }
    if (matchesShortcut(event, shortcuts.runAll)) {
      take()
      if (!w.workflowBusy && !w.workflowRunDisabled) void w.runWorkflow()
      return
    }
    if (matchesShortcut(event, shortcuts.runGroup)) {
      if (!task) return
      // A container is its own group; another node runs the group it is in.
      const group =
        map.subflows?.find((g) => g.id === task.id) ??
        map.subflows?.find((g) => g.id === task.subflowId)
      if (!group) return
      take()
      const blocked =
        w.workflowBusy || w.workflowStarting || w.busy || w.running
      if (!blocked && groupContents(map, group.id).tasks.size)
        void w.runWorkflow(group.id)
      return
    }
    if (matchesShortcut(event, shortcuts.run)) {
      if (!task || !enterRunsSelected(event.target, task.id)) return
      const spec = catalog?.tasks.find((s) => s.name === task.task)
      take()
      const busy =
        w.workflowBusy || w.busy || !!(w.taskJob && activeJob(w.taskJob))
      if (!busy && !w.checking && runsAlone(spec)) void w.run(task.id)
    }
  })
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener("keydown", listener)
    return () => window.removeEventListener("keydown", listener)
  }, [])
}
