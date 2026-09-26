import { nodeLayout } from "@/lib/node-interaction"
import { autoLayoutMap } from "@/lib/subflow"
import { updateOutputPort, removeOutputPort } from "@/lib/output-ports"
import { useState } from "react"
import { moveTaskToSubflow } from "@/lib/subflow"
import { type Catalog, type Preferences, type Frame } from "@/lib/workbench"
import {
  removeTask,
  addTask,
  duplicateTask,
  makeInstance,
  connect,
  type TaskMap,
  type Instance,
} from "@/lib/task-map"

export function useTaskEditing({
  catalog,
  prefs,
  map,
  update,
  rows,
  task,
}: {
  catalog: Catalog | null
  prefs: Preferences
  map: TaskMap
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
  rows: Frame[]
  task: Instance | undefined
}) {
  function add(name: string, ids: string[]) {
    if (!catalog) return false
    const s = catalog.tasks.find((s) => s.name === name)!
    const t = makeInstance(s, catalog, prefs)
    const count = map.tasks.filter((t) => t.task === name).length
    if (count) t.label = (s.taskName || name) + " " + (count + 1)
    update((m) => {
      let next = addTask(m, t)
      if (ids.length && s.inputs.length)
        next = connect(
          next,
          t.id,
          s.inputs[0].name,
          { kind: "files", ids, label: "선택한 자료" },
          false
        )
      return next
    }, `${t.label} 추가`)
    return true
  }
  function remove(id: string) {
    update(
      (m) => removeTask(m, id),
      `${map.tasks.find((task) => task.id === id)?.label || "작업"} 삭제`
    )
  }
  function duplicate(id: string) {
    update(
      (m) => {
        const original = m.tasks.find((t) => t.id === id)
        if (!original) return m
        if (!catalog) return m
        const layout = nodeLayout(m, catalog, rows)
        const position = layout.find((node) => node.id === id)!
        const nextPosition = { x: position.x + 48, y: position.y + 48 }
        while (
          layout.some(
            (node) => node.x === nextPosition.x && node.y === nextPosition.y
          )
        ) {
          nextPosition.x += 48
          nextPosition.y += 48
        }
        return duplicateTask(m, id, nextPosition)
      },
      `${map.tasks.find((task) => task.id === id)?.label || "작업"} 복제`
    )
  }
  function edit(fn: (t: Instance) => Instance) {
    if (!task) return
    const id = task.id
    update((m) => {
      const before = m.tasks.find((t) => t.id === id)!
      const after = fn(before)
      let next = { ...m, tasks: m.tasks.map((t) => (t.id === id ? after : t)) }
      if (after.outputPorts !== before.outputPorts) {
        for (const port of before.outputPorts || [])
          if (!after.outputPorts?.some((p) => p.id === port.id))
            next = removeOutputPort(next, id, port.id)
        for (const port of after.outputPorts || [])
          if (before.outputPorts?.find((p) => p.id === port.id) !== port)
            next = updateOutputPort(next, id, port, catalog!)
        if (after.subflowId && after.position && catalog)
          next = moveTaskToSubflow(
            next,
            catalog,
            id,
            after.subflowId,
            after.position
          )
      }
      return next
    }, `${task.label} 설정 변경`)
  }

  function template() {
    if (!catalog) return false
    let next = map
    const names = ["zerocombine", "darkcombine", "flatcombine", "ccdproc"]
    const tasks = names.map((n) =>
      makeInstance(
        catalog.tasks.find((s) => s.name === n)!,
        catalog,
        prefs
      )
    )
    for (const t of tasks) next = addTask(next, t)
    for (let i = 0; i < 3; i++)
      next = connect(
        next,
        tasks[3].id,
        ["zero", "dark", "flat"][i],
        { kind: "pending", taskId: tasks[i].id },
        false
      )
    update(() => next, "보정 워크플로우 추가")
    return true
  }

  const [layoutBusy, setLayoutBusy] = useState(false)
  async function autoLayout(straight = false) {
    if (layoutBusy || !catalog) return false
    setLayoutBusy(true)
    try {
      const next = await autoLayoutMap(map, catalog, rows)
      update((current) => {
        // Keep edits made while the engine was loading or calculating.
        if (
          current.tasks !== map.tasks ||
          current.connections !== map.connections ||
          current.subflows !== map.subflows
        )
          return current
        return {
          ...current,
          tasks: next.tasks,
          subflows: next.subflows,
          edgeRoutes: next.edgeRoutes,
          view: {
            ...current.view,
            ...(straight ? { edgeStyle: "smoothstep" as const } : {}),
          },
        }
      }, "자동 배치")
      return true
    } finally {
      setLayoutBusy(false)
    }
  }

  return {
    add,
    edit,
    autoLayout,
    layoutBusy,
    remove,
    duplicate,
    template,
  }
}
