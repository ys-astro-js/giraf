/**
 * A node's CL line edited in place (inspector 정보 tab, 명령): the server
 * reads the line as shown and as edited (giraf/command_parse.py), and the
 * parameters that changed go back to the node the way the inspector sets
 * them. A split task's group line changes only that group's values
 * (`draft.groupValues`); a value every group then shares is the shared one.
 * Files and connections are not rewired from text: a different input is an
 * issue, shown with the node's other diagnostics.
 */
import type { ParsedLine } from "./command-workflow"
import type { Instance, TaskMap } from "./task-map"
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

function shared(task: Instance, change: Change): Values[string] | undefined {
  const place = change.place
  if (typeof place === "object") return task.parameterSets?.[place.pset]?.[change.name]
  if (place === "parameters") return task.draft.parameters[change.name]
  if (place === "preprocess") return task.preprocess.parameters[change.name]
  return task.packageValues[change.name]
}

function setShared(task: Instance, change: Change): Instance {
  const place = change.place, { name, value } = change
  if (typeof place === "object")
    return { ...task, parameterSets: { ...task.parameterSets, [place.pset]: { ...task.parameterSets?.[place.pset], [name]: value } } }
  if (place === "parameters") return { ...task, draft: { ...task.draft, parameters: { ...task.draft.parameters, [name]: value } } }
  if (place === "preprocess") return { ...task, preprocess: { ...task.preprocess, parameters: { ...task.preprocess.parameters, [name]: value } } }
  return { ...task, packageValues: { ...task.packageValues, [name]: value } }
}

/**
 * The node after its line `before` became `after`. With `group`, the line is
 * that group's of a split task whose groups are `groups`.
 */
export function applyCommandEdit(task: Instance, spec: Spec, catalog: Catalog, before: ParsedLine, after: ParsedLine,
  group?: { id: string; groups: string[] }): Instance {
  const issues = [...after.issues]
  if (after.kind !== "task" || after.task !== before.task)
    issues.push(`${after.text.split(/\s+/)[0]}: 이 노드의 작업이 아닙니다.`)
  let next = task
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
      next = spec.adapter === "generic"
        ? { ...next, draft: { ...next.draft, outputs: { ...next.draft.outputs, [role]: value } } }
        : { ...next, draft: { ...next.draft, output: { ...next.draft.output, name: value } } }
    }
    for (const change of changes) {
      if (!group || group.groups.length < 2) {
        next = setShared(next, change)
        continue
      }
      if (typeof change.place === "string" && change.place !== "parameters") {
        issues.push(`${change.name}: 그룹마다 다르게 정할 수 없는 값입니다.`)
        continue
      }
      const key = groupKey(change)
      const values = next.draft.groupValues?.[key] ?? {}
      const base = text(shared(next, change))
      const after = group.groups.map((id) => (id === group.id ? change.value : text(values[id] ?? base)))
      const groupValues = { ...next.draft.groupValues }
      if (after.every((v) => v === change.value)) {
        // Every group now reads it: the shared value.
        next = setShared(next, change)
        delete groupValues[key]
      } else {
        const own = { ...values, [group.id]: change.value }
        if (change.value === base) delete own[group.id]
        if (Object.keys(own).length) groupValues[key] = own
        else delete groupValues[key]
      }
      next = { ...next, draft: { ...next.draft, groupValues } }
    }
  }
  const { commandIssues: _old, ...rest } = next
  void _old
  return issues.length ? { ...rest, commandIssues: issues } : rest
}

/** The editor's issues from edited command lines, shown with the server's diagnostics. */
export function commandIssues(map: TaskMap) {
  return map.tasks.flatMap((task) => (task.commandIssues ?? []).map((message, i) => ({
    id: `command:${task.id}:${i}`, severity: "warning" as const, message, nodeId: task.id, label: task.label,
  })))
}
