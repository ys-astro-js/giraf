import { nodeLayout } from "@/lib/node-interaction"
import { autoLayoutMap } from "@/lib/subflow"
import { isValueNode } from "@/lib/values"
import { nextValueLabel } from "@/lib/value-take"
import { updateOutputPort, removeOutputPort } from "@/lib/output-ports"
import { useRef, useState } from "react"
import { moveTaskToSubflow } from "@/lib/subflow"
import { type Catalog, type Preferences, type Frame } from "@/lib/workbench"
import {
  removeTask,
  addTask,
  duplicateTask,
  copyTasks,
  pasteTasks,
  makeInstance,
  type TaskClip,
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
    // Every 값 node is one kind, whatever its 가져오기: titled and numbered together.
    if (isValueNode(s)) t.label = nextValueLabel(map, catalog)
    else {
      const count = map.tasks.filter((task) => task.task === name).length
      if (count) t.label = (s.taskName || name) + " " + (count + 1)
    }
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
  // The app's own clipboard: a snapshot, so it pastes after the originals change or go.
  const clipboard = useRef<TaskClip | null>(null)
  function copy(ids: string[]) {
    if (!catalog) return false
    const layout = nodeLayout(map, catalog, rows)
    const clip = copyTasks(map, ids, (id) => layout.find((node) => node.id === id))
    if (clip) clipboard.current = clip
    return !!clip
  }
  function paste() {
    const clip = clipboard.current
    if (!clip || !catalog) return false
    const label =
      clip.roots.length > 1
        ? `작업 ${clip.roots.length}개`
        : clip.tasks.find((t) => t.id === clip.roots[0])?.label || "작업"
    update(
      (m) => pasteTasks(m, clip, nodeLayout(m, catalog, rows)),
      `${label} 붙여넣기`
    )
    return true
  }
  function edit(fn: (t: Instance) => Instance, id = task?.id) {
    const target = map.tasks.find((t) => t.id === id)
    if (!id || !target) return
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
    }, `${target.label} 설정 변경`)
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
    copy,
    paste,
  }
}
