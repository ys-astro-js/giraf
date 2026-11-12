/**
 * A node's CL line edited in place (inspector 정보 tab, 명령): the server
 * reads the line as shown and as edited (giraf/command_parse.py), and the
 * parameters that changed go back to the node the way the inspector sets
 * them. A split task's group line changes only that group's values
 * (`draft.groupValues`); a value every group then shares is the shared one.
 * A pset fed by a 작업 설정 node is that node's shared values, set there as
 * the inspector's settings set them. Files and connections are not rewired
 * from text: a different input is an issue, shown with the node's other
 * diagnostics.
 */
import type { ParsedLine } from "./command-workflow"
import type { Instance, TaskMap } from "./task-map"
import { psetSource } from "./values"
import type { Catalog, Param, Spec, Values } from "./workbench"

type Place = "parameters" | "preprocess" | "packageValues" | { pset: string }
type Change = { place: Place; name: string; value: string }

const text = (value: unknown) => String(value ?? "")

function entries(line: ParsedLine): Map<string, Change> {
  const result = new Map<string, Change>()
  for (const [name, value] of Object.entries(line.parameters ?? {}))
    result.set(name, { place: "parameters", name, value: text(value) })
  for (const [pset, values] of Object.entries(line.parameterSets ?? {}))
    for (const [name, value] of Object.entries(values))
      result.set(`${pset}.${name}`, { place: { pset }, name, value: text(value) })
  for (const [name, value] of Object.entries(line.preprocess ?? {}))
    result.set(`ccdproc:${name}`, { place: "preprocess", name, value: text(value) })
  for (const [name, value] of Object.entries(line.packageValues ?? {}))
    result.set(`package:${name}`, { place: "packageValues", name, value: text(value) })
  return result
}

function defaultOf(spec: Spec, catalog: Catalog, place: Place, name: string): string {
  const rows: Param[] = place === "parameters" ? spec.parameters
    : place === "preprocess" ? catalog.ccdproc.parameters
      : place === "packageValues" ? catalog.ccdred
        : spec.parameterSets?.find((s) => s.name === place.pset)?.parameters ?? []
  return text(rows.find((p) => p.name === name)?.default)
}

/** The key `draft.groupValues` uses: `name`, or `pset.name`. */
const groupKey = (change: Change) => (typeof change.place === "object" ? `${change.place.pset}.${change.name}` : change.name)

/** Where a pset's values are kept: the task, or the 작업 설정 node feeding it, under the name it holds them. */
function psetOwner(map: TaskMap, task: Instance, pset: string): { owner: string; held: string } {
  const node = psetSource(map, task.id, pset)
  return node?.draft.pset ? { owner: node.id, held: node.draft.pset.name } : { owner: task.id, held: pset }
}

const taskOf = (map: TaskMap, id: string) => map.tasks.find((t) => t.id === id)!
const withTask = (map: TaskMap, id: string, fn: (t: Instance) => Instance): TaskMap =>
  ({ ...map, tasks: map.tasks.map((t) => (t.id === id ? fn(t) : t)) })

function shared(map: TaskMap, task: Instance, change: Change): Values[string] | undefined {
  const place = change.place
  if (typeof place === "object") {
    const { owner, held } = psetOwner(map, task, place.pset)
    return taskOf(map, owner).parameterSets?.[held]?.[change.name]
  }
  if (place === "parameters") return task.draft.parameters[change.name]
  if (place === "preprocess") return task.preprocess.parameters[change.name]
  return task.packageValues[change.name]
}

function setShared(map: TaskMap, task: Instance, change: Change): TaskMap {
  const place = change.place, { name, value } = change
  if (typeof place === "object") {
    const { owner, held } = psetOwner(map, task, place.pset)
    return withTask(map, owner, (t) => ({ ...t, parameterSets: { ...t.parameterSets, [held]: { ...t.parameterSets?.[held], [name]: value } } }))
  }
  return withTask(map, task.id, (t) => {
    if (place === "parameters") return { ...t, draft: { ...t.draft, parameters: { ...t.draft.parameters, [name]: value } } }
    if (place === "preprocess") return { ...t, preprocess: { ...t.preprocess, parameters: { ...t.preprocess.parameters, [name]: value } } }
    return { ...t, packageValues: { ...t.packageValues, [name]: value } }
  })
}

/**
 * The map after node `taskId`'s line `before` became `after`. With `group`,
 * the line is that group's of a split task whose groups are `groups`.
 */
export function applyCommandEdit(map: TaskMap, taskId: string, spec: Spec, catalog: Catalog, before: ParsedLine, after: ParsedLine,
  group?: { id: string; groups: string[] }): TaskMap {
  const issues = [...after.issues]
  if (after.kind !== "task" || after.task !== before.task)
    issues.push(`${after.text.split(/\s+/)[0]}: 이 노드의 작업이 아닙니다.`)
  let next = map
  const edit = (fn: (t: Instance) => Instance) => { next = withTask(next, taskId, fn) }
  if (!issues.length) {
    const old = entries(before), now = entries(after)
    const changes: Change[] = []
    for (const [key, change] of now) if (old.get(key)?.value !== change.value) changes.push(change)
    // A parameter left out takes its IRAF default, as the line shows only what differs.
    for (const [key, change] of old)
      if (!now.has(key)) changes.push({ ...change, value: defaultOf(spec, catalog, change.place, change.name) })
    for (const role of new Set([...Object.keys(before.inputs ?? {}), ...Object.keys(after.inputs ?? {})]))
      if (before.inputs?.[role]?.text !== after.inputs?.[role]?.text)
        issues.push(`${role}: 연결된 입력과 다른 이름입니다. 입력은 노드의 연결로 바꾸세요.`)
    for (const role of new Set([...Object.keys(before.outputs ?? {}), ...Object.keys(after.outputs ?? {})])) {
      const value = after.outputs?.[role]?.text
      if (before.outputs?.[role]?.text === value) continue
      const slot = spec.adapter === "generic" ? spec.outputs?.find((o) => o.name === role) : spec.output
      const single = !!slot && !["each", "pass", "edit"].includes(slot.mode ?? "")
      if (group || !single || !value) {
        issues.push(`${role}: 이 출력 이름은 출력 탭에서 바꾸세요.`)
        continue
      }
      edit((t) => spec.adapter === "generic"
        ? { ...t, draft: { ...t.draft, outputs: { ...t.draft.outputs, [role]: value } } }
        : { ...t, draft: { ...t.draft, output: { ...t.draft.output, name: value } } })
    }
    for (const change of changes) {
      const task = taskOf(next, taskId)
      if (!group || group.groups.length < 2) {
        next = setShared(next, task, change)
        continue
      }
      if (typeof change.place === "string" && change.place !== "parameters") {
        issues.push(`${change.name}: 그룹마다 다르게 정할 수 없는 값입니다.`)
        continue
      }
      const key = groupKey(change)
      const values = task.draft.groupValues?.[key] ?? {}
      const base = text(shared(next, task, change))
      const after = group.groups.map((id) => (id === group.id ? change.value : text(values[id] ?? base)))
      const groupValues = { ...task.draft.groupValues }
      if (after.every((v) => v === change.value)) {
        // Every group now reads it: the shared value.
        next = setShared(next, task, change)
        delete groupValues[key]
      } else {
        const own = { ...values, [group.id]: change.value }
        if (change.value === base) delete own[group.id]
        if (Object.keys(own).length) groupValues[key] = own
        else delete groupValues[key]
      }
      edit((t) => ({ ...t, draft: { ...t.draft, groupValues } }))
    }
  }
  // What the line could not set warns on the node until its next edit.
  return withTask(next, taskId, (t) => {
    const { commandIssues: _old, ...rest } = t
    void _old
    return issues.length ? { ...rest, commandIssues: issues } : rest
  })
}

/** The editor's issues from edited command lines, shown with the server's diagnostics. */
export function commandIssues(map: TaskMap) {
  return map.tasks.flatMap((task) => (task.commandIssues ?? []).map((message, i) => ({
    id: `command:${task.id}:${i}`, severity: "warning" as const, message, nodeId: task.id, label: task.label,
  })))
}
