import {
  defaults,
  makeDraft,
  type Catalog,
  type Draft,
  type Preferences,
} from "@/lib/workbench"
import {
  uid,
  emptyMap,
  makeInstance,
  type Instance,
  type TaskMap,
} from "./model"
import type { payloadFor } from "./payload"
const clone = <T,>(value: T): T => structuredClone(value)

export function addTask(map: TaskMap, task: Instance): TaskMap {
  return {
    ...map,
    tasks: [...map.tasks, clone(task)],
    view: { ...map.view, selected: task.id },
  }
}

export function duplicateTask(
  map: TaskMap,
  id: string,
  position: { x: number; y: number }
): TaskMap {
  const original = map.tasks.find((task) => task.id === id)
  if (!original) return map
  const task = { ...clone(original), id: uid(), position }
  return {
    ...map,
    tasks: [...map.tasks, task],
    connections: [
      ...map.connections,
      ...map.connections
        .filter((link) => link.target === id)
        .map((link) => ({
          ...clone(link),
          id: uid(),
          target: task.id,
        })),
    ],
    view: { ...map.view, selected: task.id },
  }
}

export function restoreRun(
  map: TaskMap,
  job: {
    id: string
    task?: string
    manifest?: Partial<ReturnType<typeof payloadFor>> & {
      inputSelections?: Record<string, string[]>
    }
  },
  catalog: Catalog,
  prefs: Preferences,
  id = uid()
) {
  const m = job.manifest
  if (!m?.task) throw Error("실행 설정이 없습니다.")
  const restoredSpec = catalog.tasks.find((t) => t.name === m.task)
  if (!restoredSpec)
    throw Error(
      "기록에 사용된 패키지를 설치한 뒤 작업 목록을 새로고침해 주세요."
    )
  const t = makeInstance(restoredSpec, catalog, prefs, id)
  t.label = t.task + " 기록 복원"
  t.draft = makeDraft(
    catalog.tasks.find((s) => s.name === t.task)!,
    { ...m, inputs: m.inputSelections || m.inputs } as Partial<Draft>
  )
  t.preprocess.parameters = clone(m.ccdproc || t.preprocess.parameters)
  t.preprocess.inputs = clone(m.inputs || {})
  t.packageValues = clone(m.ccdred || t.packageValues)
  t.parameterSets = clone(m.parameterSets || t.parameterSets)
  t.mapping = clone(m.mapping || t.mapping)
  t.backend = m.backend || t.backend
  t.instrument = clone(m.inputs?.instrument || [])
  t.expressions = clone(m.expressions || {})
  return addTask(map, t)
}

export function migrateMap(prefs: Preferences, catalog: Catalog): TaskMap {
  if (prefs.taskMap?.version === 1) {
    const map = clone(prefs.taskMap)
    map.connections = map.connections.filter(
      (c) => c.source.kind !== "files" || c.source.ids.length > 0
    )
    map.tasks = map.tasks.map((t) => {
      const spec = catalog.tasks.find((s) => s.name === t.task)
      return spec?.adapter === "generic"
        ? {
            ...t,
            draft: makeDraft(spec, t.draft),
            parameterSets: Object.fromEntries(
              (spec.parameterSets || []).map((group) => [
                group.name,
                {
                  ...defaults(group.parameters),
                  ...t.parameterSets?.[group.name],
                },
              ])
            ),
          }
        : t
    })
    return map
  }
  let m = emptyMap()
  for (const spec of catalog.tasks)
    if (
      Object.values(prefs.drafts[spec.name]?.inputs || {}).some(
        (ids) => ids.length
      )
    )
      m = addTask(m, makeInstance(spec, catalog, prefs))
  return m
}

export function layoutMap(
  map: TaskMap
): { id: string; x: number; y: number }[] {
  const levels = new Map<string, number>()
  const depth = (id: string, seen = new Set<string>()): number => {
    if (levels.has(id)) return levels.get(id)!
    if (seen.has(id)) return 0
    seen.add(id)
    const parents = map.connections
      .filter((c) => c.target === id && c.source.kind !== "files")
      .map((c) =>
        c.source.kind === "pending" || c.source.kind === "result"
          ? c.source.taskId
          : undefined
      )
      .filter((v): v is string => !!v && map.tasks.some((t) => t.id === v))
    const d = parents.length
      ? Math.max(...parents.map((p) => depth(p, new Set(seen)))) + 1
      : 0
    levels.set(id, d)
    return d
  }
  const slots = new Map<number, number>()
  return map.tasks.map((t) => {
    const d = depth(t.id),
      i = slots.get(d) || 0
    slots.set(d, i + 1)
    return {
      id: t.id,
      ...(t.position || { x: 40 + d * 320, y: 40 + i * 200 }),
    }
  })
}

export const stateLabel = (state: string) =>
  ({
    queued: "준비 중",
    running: "실행 중",
    waiting: "사용자 입력 대기",
    completed: "완료",
    processed: "처리됨",
    skipped: "건너뜀",
    partial: "부분 실패",
    failed: "실패",
    cancelled: "중단됨",
    planned: "처리 계획",
    draft: "실행 전",
  })[state] || state

/** Commit one movement, translating pointer displacement at the current zoom. */
export function moveTask(
  map: TaskMap,
  id: string,
  origin: { x: number; y: number },
  delta: { x: number; y: number },
  zoom: number
): TaskMap {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1
  const position = {
    x: Math.max(24, origin.x + delta.x / scale),
    y: Math.max(24, origin.y + delta.y / scale),
  }
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return map
  return {
    ...map,
    tasks: map.tasks.map((t) => (t.id === id ? { ...t, position } : t)),
  }
}

export function removeTask(map: TaskMap, id: string): TaskMap {
  const index = map.tasks.findIndex((t) => t.id === id)
  if (index < 0) return map
  const tasks = map.tasks.filter((t) => t.id !== id)
  return {
    ...map,
    tasks,
    connections: map.connections
      .filter(
        (c) =>
          c.target !== id &&
          !(c.source.kind === "pending" && c.source.taskId === id)
      )
      .map((c) => {
        if (c.source.kind !== "result" || c.source.taskId !== id) return c
        const { taskId: _, ...source } = c.source
        return { ...c, source }
      }),
    view: {
      ...map.view,
      selected:
        map.view.selected === id
          ? tasks[Math.min(index, tasks.length - 1)]?.id || ""
          : map.view.selected,
    },
  }
}

/** Restore a deletion without reverting subsequent edits or asynchronous runs. */
export function restoreTask(
  map: TaskMap,
  before: TaskMap,
  id: string
): TaskMap {
  const task = before.tasks.find((t) => t.id === id)
  if (!task || map.tasks.some((t) => t.id === id)) return map
  const tasks = [...map.tasks]
  tasks.splice(
    Math.min(before.tasks.indexOf(task), tasks.length),
    0,
    clone(task)
  )
  const affected = before.connections.filter(
    (c) =>
      c.target === id || (c.source.kind !== "files" && c.source.taskId === id)
  )
  const connections = [...map.connections]
  for (const c of affected) {
    if (!tasks.some((t) => t.id === c.target)) continue
    const existing = connections.findIndex((x) => x.id === c.id)
    if (existing >= 0) {
      // Reattach provenance only; never replace edited file selections.
      const current = connections[existing]
      if (
        current.source.kind === "result" &&
        c.source.kind === "result" &&
        current.source.runId === c.source.runId
      )
        connections[existing] = {
          ...current,
          source: { ...current.source, taskId: id },
        }
      continue
    }
    if (map.connections.some((x) => x.target === c.target && x.role === c.role))
      continue
    if (
      c.source.kind === "pending" &&
      !tasks.some(
        (t) => t.id === ("taskId" in c.source ? c.source.taskId : undefined)
      )
    )
      continue
    connections.push(clone(c))
  }
  return { ...map, tasks, connections, view: { ...map.view, selected: id } }
}
