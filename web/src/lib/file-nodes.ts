import { connectionRoles } from "./task-map/connections"
import { makeInstance, uid, type Connection, type Instance, type TaskMap } from "./task-map/model"
import { acceptsAsset, acceptsSource, type Catalog, type Frame, type Spec } from "./workbench"
import { COLLAPSED_WIDTH } from "./node-interaction"
import { syncPassOutputs } from "./output-ports"
import { syncContainerItems } from "./containers"

/**
 * A source node takes files only (no node connections) and passes them on
 * unchanged through `pass` outputs: the node schema's file input.
 */
export function isSourceNode(spec: Spec | undefined): boolean {
  return !!spec?.outputs?.some((o) => o.mode === "pass") &&
    spec.inputs.length > 0 &&
    spec.inputs.every((i) => !acceptsSource(i, "node") && acceptsSource(i, "files"))
}

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n")

/** A short name for a set of files: the one file, or the stem they share. */
export function filesLabel(ids: string[], rows: Frame[], fallback: string): string {
  const names = ids.map((id) => rows.find((r) => r.id === id)?.label).filter((n): n is string => !!n)
    .map((n) => n.replace(/\.(fits?|fit|fts|imh|txt|dat|lst|list)$/i, ""))
  if (!names.length) return fallback
  if (names.length === 1) return names[0]
  let prefix = names[0]
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1)
  // A prefix that stops inside a running number (bias001…) drops that number.
  if (/\d/.test(names[0][prefix.length] ?? "")) prefix = prefix.replace(/\d+$/, "")
  prefix = prefix.replace(/[\s_.-]+$/, "")
  return prefix.length >= 2 ? prefix : fallback
}

/** The pass output that carries these files into a slot of the given kind. */
function passOutput(spec: Spec, ids: string[], rows: Frame[], slotKind: string): string | undefined {
  const pass = spec.outputs?.filter((o) => o.mode === "pass") ?? []
  const assets = new Set(ids.map((id) => rows.find((r) => r.id === id)?.asset || "image"))
  const carried = pass.filter((o) => [...assets].some((a) => a === o.kind))
  return (carried.find((o) => acceptsAsset(slotKind, o.kind)) ?? carried[0] ??
    pass.find((o) => acceptsAsset(slotKind, o.kind)) ?? pass[0])?.name
}

/**
 * Files always reach a task through a source node on the canvas. Any files a
 * task input holds directly (a `files` connection or legacy draft ids) move
 * into a source node, reused when one already holds exactly those files, and
 * the input connects to its pass output instead.
 */
export function routeFilesThroughNodes(map: TaskMap, catalog: Catalog | null, rows: Frame[]): TaskMap {
  const source = catalog?.tasks.find(isSourceNode)
  if (!catalog || !source) return map
  const specOf = (t: Instance) => catalog.tasks.find((s) => s.name === t.task)
  const filesRole = source.inputs[0].name
  let tasks = map.tasks
  let connections = map.connections
  let changed = false
  const legacy: Connection[] = []
  // Legacy draft ids first become ordinary file connections.
  tasks = tasks.map((t) => {
    const spec = specOf(t)
    if (!spec || isSourceNode(spec)) return t
    let draft = t.draft, preprocess = t.preprocess
    for (const slot of connectionRoles(spec, catalog)) {
      if (!acceptsSource(slot, "node")) continue
      const ids = t.draft.inputs[slot.name]?.length ? t.draft.inputs[slot.name] : t.preprocess.inputs[slot.name] || []
      if (!ids.length) continue
      if (!connections.some((c) => c.target === t.id && c.role === slot.name))
        legacy.push({ id: uid(), target: t.id, role: slot.name, source: { kind: "files", ids: [...ids], label: slot.label } })
      draft = { ...draft, inputs: { ...draft.inputs, [slot.name]: [] } }
      preprocess = { ...preprocess, inputs: { ...preprocess.inputs, [slot.name]: [] } }
    }
    if (draft === t.draft && preprocess === t.preprocess) return t
    changed = true
    return { ...t, draft, preprocess }
  })
  connections = [...connections, ...legacy]
  // The files each source node holds, including nodes made in this pass.
  const held = new Map<string, string[]>()
  for (const c of connections)
    if (c.role === filesRole && c.source.kind === "files" && tasks.some((t) => t.id === c.target && specOf(t) === source))
      held.set(c.target, c.source.ids)
  const placed = new Map<string, number>()
  const created: Instance[] = []
  connections = connections.flatMap((c) => {
    if (c.source.kind !== "files" || !c.source.ids.length) return [c]
    const target = tasks.find((t) => t.id === c.target)
    const spec = target && specOf(target)
    const slot = spec && connectionRoles(spec, catalog).find((s) => s.name === c.role)
    if (!target || !spec || !slot || isSourceNode(spec) || !acceptsSource(slot, "node")) return [c]
    const ids = c.source.ids
    let node = [...tasks, ...created].find((t) => sameIds(held.get(t.id) ?? [], ids))
    const extra: Connection[] = []
    if (!node) {
      node = makeInstance(source, catalog, { drafts: {}, backend: target.backend, mapping: target.mapping, instrument: target.instrument, packageValues: target.packageValues })
      node.label = filesLabel(ids, rows, slot.name)
      node.collapsed = true
      node.subflowId = target.subflowId
      if (target.position) {
        const n = placed.get(target.id) ?? 0
        placed.set(target.id, n + 1)
        node.position = { x: target.position.x - COLLAPSED_WIDTH - 80, y: target.position.y + n * 56 }
      }
      created.push(node)
      held.set(node.id, ids)
      extra.push({ id: uid(), target: node.id, role: filesRole, source: { kind: "files", ids: [...ids], label: node.label } })
    }
    changed = true
    const outputRole = passOutput(source, ids, rows, slot.kind)
    return [...extra, { ...c, source: { kind: "pending", taskId: node.id, ...(outputRole ? { outputRole } : {}) } }]
  })
  if (!changed) return map
  return { ...map, version: 2, tasks: [...tasks, ...created], connections }
}

/** Every map passes through this on load and on each edit (version 2 form). */
export function normalizeFileInputs(map: TaskMap, catalog: Catalog | null, rows: Frame[]): TaskMap {
  const routed = routeFilesThroughNodes(map, catalog, rows)
  // A foreach hands its members the first item when they run alone.
  const synced = syncContainerItems(syncPassOutputs(routed, catalog, rows), catalog, rows)
  return synced.version === 2 ? synced : { ...synced, version: 2 }
}
