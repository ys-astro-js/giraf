import type { CalibrationGroup } from "@/lib/calibration-ports"
import { type Catalog, type Frame, type Spec } from "@/lib/workbench"
import { uid, type Source, type TaskMap } from "./model"
const clone = <T,>(value: T): T => structuredClone(value)

export function connectionRoles(spec: Spec, catalog: Catalog) {
  return [
    ...spec.inputs,
    ...(spec.preprocess
      ? catalog.ccdproc.inputs.filter(
          (s) => !spec.inputs.some((x) => x.name === s.name)
        )
      : []),
  ]
}

export function connect(
  map: TaskMap,
  target: string,
  role: string,
  source: Source,
  append = true,
  targetGroup?: CalibrationGroup
): TaskMap {
  if (!map.tasks.some((t) => t.id === target))
    throw Error("대상 task가 없습니다.")
  const parent = source.kind !== "files" ? source.taskId : undefined
  if (parent) {
    const reaches = (id: string, seen = new Set<string>()): boolean => {
      if (id === parent) return true
      if (seen.has(id)) return false
      seen.add(id)
      return map.connections.some(
        (c) =>
          c.source.kind !== "files" &&
          c.source.taskId === id &&
          reaches(c.target, seen)
      )
    }
    if (reaches(target)) throw Error("순환 연결은 만들 수 없습니다.")
  }
  const connections = append
    ? map.connections
    : map.connections.filter((c) => c.target !== target || c.role !== role)
  return {
    ...map,
    connections: [
      ...connections.filter(
        (c) =>
          !(c.source.kind === "files" && !c.source.ids.length) &&
          !(
            c.target === target &&
            c.role === role &&
            JSON.stringify(c.source) === JSON.stringify(source)
          )
      ),
      ...(source.kind === "files" && !source.ids.length
        ? []
        : [
            {
              id: uid(),
              target,
              role,
              source: clone(source),
              ...(targetGroup ? { targetGroup } : {}),
            },
          ]),
    ],
    tasks: map.tasks.map((t) =>
      t.id !== target
        ? t
        : {
            ...t,
            expressions: { ...t.expressions, [role]: "" },
            draft: { ...t.draft, inputs: { ...t.draft.inputs, [role]: [] } },
            preprocess: {
              ...t.preprocess,
              inputs: { ...t.preprocess.inputs, [role]: [] },
            },
          }
    ),
  }
}

export function replaceRoleInputs(
  map: TaskMap,
  target: string,
  role: string,
  ids: string[],
  rows: Frame[]
): TaskMap {
  const prior = map.connections
    .filter((c) => c.target === target && c.role === role)
    .map((c) => c.source)
  const sources: Source[] = []
  for (const id of ids) {
    const old = prior.find((s) => s.kind !== "pending" && s.ids.includes(id)),
      row = rows.find((r) => r.id === id)
    const source: Source =
      old && old.kind !== "pending"
        ? { ...old, ids: [id] }
        : row?.job
          ? { kind: "result", runId: row.job, ids: [id] }
          : { kind: "files", label: "선택한 자료", ids: [id] }
    const last = sources.at(-1)
    if (
      last &&
      last.kind !== "pending" &&
      JSON.stringify({ ...last, ids: [] }) ===
        JSON.stringify({ ...source, ids: [] })
    )
      last.ids.push(id)
    else sources.push(source)
  }
  const cleared = connect(
    map,
    target,
    role,
    { kind: "files", ids: [], label: "" },
    false
  )
  return {
    ...cleared,
    connections: [
      ...cleared.connections.filter(
        (c) => c.target !== target || c.role !== role
      ),
      ...sources.map((source) => ({ id: uid(), target, role, source })),
    ],
  }
}

export function disconnect(map: TaskMap, id: string): TaskMap {
  return { ...map, connections: map.connections.filter((c) => c.id !== id) }
}
