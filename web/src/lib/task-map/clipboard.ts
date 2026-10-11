import { groupContents } from "../group-nesting"
import { uid, type Connection, type Subflow, type TaskMap, type Instance } from "./model"

const clone = <T,>(value: T): T => structuredClone(value)

/**
 * Copied nodes, kept apart from the map so they paste after the originals
 * change or go: the tasks (a container with its group and members), their
 * groups, and the links into them.
 */
export type TaskClip = {
  /** The copied nodes themselves, without what came along inside them. */
  roots: string[]
  tasks: Instance[]
  subflows: Subflow[]
  connections: Connection[]
}

const PASTE_STEP = 48

export function copyTasks(
  map: TaskMap,
  ids: string[],
  positionOf: (id: string) => { x: number; y: number } | undefined
): TaskClip | null {
  const tasks = new Set<string>()
  const groups = new Set<string>()
  const roots: string[] = []
  for (const id of ids) {
    if (tasks.has(id) || !map.tasks.some((t) => t.id === id)) continue
    roots.push(id)
    tasks.add(id)
    if (!map.subflows?.some((g) => g.id === id)) continue
    groups.add(id)
    const inside = groupContents(map, id)
    inside.tasks.forEach((t) => tasks.add(t))
    inside.groups.forEach((g) => groups.add(g))
  }
  // A node copied with a container it sits in comes once, inside it.
  const nested = roots.filter((id) => {
    const parent = map.tasks.find((t) => t.id === id)?.subflowId
    return !(parent && parent !== id && groups.has(parent))
  })
  if (!nested.length) return null
  return {
    roots: nested,
    tasks: map.tasks
      .filter((t) => tasks.has(t.id))
      .map((t) => {
        const position = t.position ?? positionOf(t.id)
        return { ...clone(t), ...(position ? { position: { x: position.x, y: position.y } } : {}) }
      }),
    subflows: (map.subflows ?? []).filter((g) => groups.has(g.id)).map(clone),
    connections: map.connections.filter((c) => tasks.has(c.target)).map(clone),
  }
}

/**
 * Paste as duplicating does: new ids, the same labels, links into the copies
 * kept and links among them waiting for the copies' own runs. The copies sit
 * one step down and right of the copied nodes, further while that place is
 * taken, so pasting again does not stack them; the first becomes the selection.
 */
export function pasteTasks(
  map: TaskMap,
  clip: TaskClip,
  occupied: { x: number; y: number }[]
): TaskMap {
  if (!clip.roots.length) return map
  const ids = new Map<string, string>()
  // A container's group shares its task's id, so its copy does too.
  for (const t of clip.tasks) ids.set(t.id, uid())
  const first = clip.roots[0]
  const anchor =
    clip.subflows.find((g) => g.id === first)?.position ??
    clip.tasks.find((t) => t.id === first)?.position ?? { x: 0, y: 0 }
  let step = PASTE_STEP
  while (occupied.some((p) => p.x === anchor.x + step && p.y === anchor.y + step))
    step += PASTE_STEP
  const move = (p: { x: number; y: number }) => ({ x: p.x + step, y: p.y + step })
  const exists = new Set(map.tasks.map((t) => t.id))
  const groupExists = (id: string) => map.subflows?.some((g) => g.id === id)
  const tasks = clip.tasks.map((t) => {
    const { subflowId, ...task } = clone(t)
    // A copy inside a copied group goes into that group's copy; one from a
    // group that is gone lands outside.
    const parent = subflowId
      ? (ids.get(subflowId) ?? (groupExists(subflowId) ? subflowId : undefined))
      : undefined
    return {
      ...task,
      id: ids.get(t.id)!,
      ...(parent ? { subflowId: parent } : {}),
      ...(t.position ? { position: move(t.position) } : {}),
    }
  })
  const subflows = clip.subflows.map((g) => ({
    ...clone(g),
    id: ids.get(g.id)!,
    position: move(g.position),
    ...(clip.roots.includes(g.id) ? { collapsed: undefined } : {}),
  }))
  const connections = clip.connections.flatMap((link): Connection[] => {
    const source = link.source
    const from = source.kind !== "files" ? source.taskId : undefined
    const copied = from ? ids.get(from) : undefined
    const base = { ...clone(link), id: uid(), target: ids.get(link.target)! }
    if (copied && source.kind !== "files")
      return [
        {
          ...base,
          source: {
            ...(source.port ? { port: source.port } : {}),
            kind: "pending",
            taskId: copied,
            ...(source.outputRole ? { outputRole: source.outputRole } : {}),
          },
        },
      ]
    if (!from || exists.has(from)) return [base]
    // The source node is gone: a result stays as kept files, a pending link goes.
    if (source.kind !== "result") return []
    const kept = clone(source)
    delete kept.taskId
    return [{ ...base, source: kept }]
  })
  return {
    ...map,
    ...(subflows.length ? { subflows: [...(map.subflows ?? []), ...subflows] } : {}),
    tasks: [...map.tasks, ...tasks],
    connections: [...map.connections, ...connections],
    view: { ...map.view, selected: ids.get(first)! },
  }
}
