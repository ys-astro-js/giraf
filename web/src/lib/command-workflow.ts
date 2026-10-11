/**
 * Nodes from IRAF CL commands. The server reads the text with the installed
 * task knowledge (`POST /api/parse-commands`, giraf/command_parse.py); this
 * turns what it read into nodes, set the way the inspector sets them, and
 * connects them by file name: a line's input that names an earlier line's
 * output takes that output, folder files come through a file node.
 *
 * A run of lines that differ only in their files may become one split node
 * (docs/node-schema.md, 나눠서 실행) when a split reproduces the lines'
 * grouping; it is offered, never done silently.
 */
import { normalizeFileInputs } from "./file-nodes"
import { splitGroups, keyChoices, withSuffix, type SplitPart, type SplitSettings } from "./splits"
import { connect, connectionRoles, emptyMap, makeInstance, type Instance, type Source, type TaskMap } from "./task-map"
import { autoLayoutMap } from "./workflow-layout"
import { acceptsSource, type Catalog, type Frame, type Preferences, type Spec, type Values } from "./workbench"

export type ParsedItem = {
  name: string
  file?: string
  from?: { line: number; role: string; label: string }
  missing?: true
}
export type ParsedLine = {
  index: number
  line: number
  text: string
  kind: "task" | "assign" | "list" | "skip" | "package" | "unknown"
  issues: string[]
  reason?: string
  task?: string
  taskName?: string
  parameters?: Values
  parameterSets?: Record<string, Values>
  preprocess?: Values
  packageValues?: Values
  inputs?: Record<string, { text: string; items: ParsedItem[] }>
  outputs?: Record<string, { text: string; value: string | null; labels: string[] }>
  /** assign */
  target?: string
  parameter?: string
  value?: string
  applied?: number[]
  /** list */
  list?: string
  files?: string[]
}
export type ParsedCommands = { lines: ParsedLine[] }

/** Lines that differ only in one input's files and their output names. */
export type CommandRun = {
  lines: number[]
  input: string
  output?: string
  split?: SplitSettings
  /** The output name the groups' suffixes go after. */
  root?: string
  /** Why no split reproduces the lines' grouping. */
  disabled?: string
}

const specOf = (catalog: Catalog, name: string | undefined) => catalog.tasks.find((s) => s.name === name)
const folderFiles = (rows: Frame[]) => rows.filter((r) => !r.job)
const imageStem = (name: string) => name.replace(/\.(fits?|fts|imh)$/i, "")

/** Everything but the files: what lines must share to be one node. */
function signature(line: ParsedLine, input: string, output: string | undefined) {
  const inputs = Object.fromEntries(Object.entries(line.inputs ?? {}).filter(([role]) => role !== input).map(([role, v]) => [role, v.text]))
  const outputs = Object.keys(line.outputs ?? {}).filter((role) => role !== output)
  return JSON.stringify([line.task, line.parameters, line.parameterSets, line.preprocess, line.packageValues, inputs, outputs])
}

/** The one input whose files differ between two lines, and the output they name. */
function differing(a: ParsedLine, b: ParsedLine): { input: string; output?: string } | undefined {
  const roles = Object.keys({ ...a.inputs, ...b.inputs }).filter((role) => a.inputs?.[role]?.text !== b.inputs?.[role]?.text)
  if (roles.length !== 1) return undefined
  const outputs = Object.keys({ ...a.outputs, ...b.outputs }).filter((role) => a.outputs?.[role]?.text !== b.outputs?.[role]?.text)
  if (outputs.length > 1) return undefined
  const input = roles[0], output = outputs[0]
  return signature(a, input, output) === signature(b, input, output) ? { input, output } : undefined
}

type Item = { key: string; label: string; item: ParsedItem }

/** A line's items in one role, keyed as the editor knows them: a folder file's id, or the output it names. */
function lineItems(line: ParsedLine, role: string, rows: Frame[]): Item[] {
  return (line.inputs?.[role]?.items ?? []).map((item) => {
    if (item.from) return { key: `out:${item.from.line}:${item.from.label}`, label: item.from.label, item }
    const row = item.file ? folderFiles(rows).find((r) => r.label === item.file) : undefined
    return row ? { key: row.id, label: row.label, item } : { key: `missing:${item.name}`, label: item.name, item }
  })
}

const sameSets = (a: string[][], b: string[][]) => {
  const norm = (sets: string[][]) => sets.map((s) => [...s].sort().join("\n")).sort().join("\n\n")
  return norm(a) === norm(b)
}

/**
 * The split of the lines' union that makes exactly the lines' lists: a header
 * keyword, `per` N in file order, a keyword then `per` N, or one per file.
 */
export function inferSplit(lists: string[][], frames: Map<string, Frame>): SplitPart[] | undefined {
  const union = [...new Set(lists.flat())]
  if (union.length !== lists.flat().length) return undefined
  const makes = (parts: SplitPart[]) => {
    const groups = splitGroups(union, parts, frames)
    return !!groups && sameSets(groups.map((g) => g.files), lists)
  }
  const keys = keyChoices(union, frames).filter((c) => c.values.length > 1).map((c) => c.key)
  const sizes = lists.map((l) => l.length)
  const per = Math.max(...sizes)
  const candidates: SplitPart[][] = [
    ...keys.map((key) => [{ key }]),
    [{ per }],
    ...keys.map((key) => [{ key }, { per }]),
    ...(per === 1 ? [[{ each: true as const }]] : []),
  ]
  return candidates.find(makes)
}

/** A node's virtual files: the outputs of earlier merged lines, with the header values their group was made by. */
type Virtual = Map<string, Frame>

/** Runs of task lines that could be one node, each with its split or why not. */
export function commandRuns(parsed: ParsedCommands, rows: Frame[], merged: ReadonlySet<number> = new Set()): CommandRun[] {
  const tasks = parsed.lines.filter((l) => l.kind === "task" && l.task && !l.issues.length)
  const runs: CommandRun[] = []
  let i = 0
  while (i < tasks.length) {
    const diff = i + 1 < tasks.length ? differing(tasks[i], tasks[i + 1]) : undefined
    if (!diff) {
      i++
      continue
    }
    let j = i + 2
    for (; j < tasks.length; j++) {
      const d = differing(tasks[i], tasks[j])
      if (!d || d.input !== diff.input || d.output !== diff.output) break
    }
    runs.push(settle({ lines: tasks.slice(i, j), ...diff }))
    i = j
  }
  return runs

  function settle(run: { lines: ParsedLine[]; input: string; output?: string }): CommandRun {
    const virtual = virtualFrames(parsed, rows, runs.filter((r) => merged.has(r.lines[0])))
    const frames = new Map([...rows, ...virtual.values()].map((f) => [f.id, f]))
    const lists = run.lines.map((l) => lineItems(l, run.input, rows))
    const result: CommandRun = { lines: run.lines.map((l) => l.index), input: run.input, output: run.output }
    if (lists.some((l) => !l.length || l.some((i) => i.item.missing)))
      return { ...result, disabled: "파일을 모두 찾지 못했습니다" }
    const parts = inferSplit(lists.map((l) => l.map((i) => i.key)), frames)
    if (!parts) return { ...result, disabled: "나누기로 같은 묶음을 만들 수 없습니다" }
    const split = { input: run.input, by: parts }
    return { ...result, split, root: run.output ? outputRoot(run.lines, run.output, lists, parts, frames) : undefined }
  }
}

/** Frames for the outputs of merged runs, carrying the header values of the group each was made by. */
function virtualFrames(parsed: ParsedCommands, rows: Frame[], runs: CommandRun[]): Virtual {
  const virtual: Virtual = new Map()
  for (const run of runs) {
    if (!run.split || !run.output) continue
    const frames = new Map([...rows, ...virtual.values()].map((f) => [f.id, f]))
    for (const index of run.lines) {
      const line = parsed.lines[index]
      const keys = lineItems(line, run.input, rows).map((i) => i.key)
      const group = splitGroups([...new Set(run.lines.flatMap((i) => lineItems(parsed.lines[i], run.input, rows).map((x) => x.key)))], run.split.by, frames)
        ?.find((g) => sameSets([g.files], [keys]))
      for (const label of line.outputs?.[run.output]?.labels ?? [])
        virtual.set(`out:${index}:${label}`, { id: `out:${index}:${label}`, label, headers: group?.keys ?? {} })
    }
  }
  return virtual
}

/** The name the groups' suffixes complete into the lines' own output names, else what they share. */
function outputRoot(lines: ParsedLine[], output: string, lists: Item[][], parts: SplitPart[], frames: Map<string, Frame>) {
  const names = lines.map((l) => l.outputs?.[output]?.value ?? "")
  const union = [...new Set(lists.flat().map((i) => i.key))]
  const groups = splitGroups(union, parts, frames) ?? []
  const roots = lines.map((_, i) => {
    const group = groups.find((g) => sameSets([g.files], [lists[i].map((x) => x.key)]))
    const name = imageStem(names[i])
    return group && name.endsWith(group.suffix) && withSuffix(name.slice(0, name.length - group.suffix.length), group.suffix) === name
      ? name.slice(0, name.length - group.suffix.length) : undefined
  })
  if (roots.every((r) => r && r === roots[0])) return roots[0]!
  let prefix = imageStem(names[0])
  for (const name of names) while (!imageStem(name).startsWith(prefix)) prefix = prefix.slice(0, -1)
  return prefix.replace(/[\s_.-]+$/, "") || imageStem(names[0])
}

/** A node set from one parsed line, as the inspector sets it. */
export function applyParsedLine(task: Instance, spec: Spec, catalog: Catalog, line: ParsedLine): Instance {
  const next: Instance = structuredClone(task)
  Object.assign(next.draft.parameters, line.parameters)
  for (const [pset, values] of Object.entries(line.parameterSets ?? {}))
    next.parameterSets = { ...next.parameterSets, [pset]: { ...next.parameterSets?.[pset], ...values } }
  Object.assign(next.preprocess.parameters, line.preprocess)
  next.packageValues = { ...next.packageValues, ...line.packageValues }
  for (const [role, output] of Object.entries(line.outputs ?? {})) {
    if (output.value === null) continue
    if (spec.adapter === "generic") next.draft.outputs = { ...next.draft.outputs, [role]: output.value }
    else next.draft.output = { ...next.draft.output, name: output.value }
  }
  // An input naming no file and no earlier output stays the literal IRAF reads.
  for (const slot of connectionRoles(spec, catalog)) {
    const value = line.inputs?.[slot.name]
    if (value?.items.length && value.items.every((i) => i.missing) && acceptsSource(slot, "expression"))
      next.expressions = { ...next.expressions, [slot.name]: value.text }
  }
  return next
}

export type BuiltCommands = {
  map: TaskMap
  /** The node each task line became. */
  nodes: Record<number, string>
  added: string[]
  /** Problems the editor finds, by line. */
  issues: Record<number, string[]>
}

/**
 * The nodes the lines make, added to `map`: one per task line, or one per
 * chosen run, connected by file name. Positions are left to `placeCommandNodes`.
 */
export function buildCommandNodes(map: TaskMap, catalog: Catalog, prefs: Preferences, rows: Frame[], parsed: ParsedCommands,
  merged: ReadonlySet<number> = new Set()): BuiltCommands {
  const runs = commandRuns(parsed, rows, merged).filter((r) => merged.has(r.lines[0]) && r.split)
  const runOf = new Map(runs.flatMap((r) => r.lines.map((i) => [i, r] as const)))
  const nodes: Record<number, string> = {}
  const issues: Record<number, string[]> = {}
  const created: { task: Instance; lines: ParsedLine[]; run?: CommandRun }[] = []
  let next = map
  for (const line of parsed.lines) {
    if (line.kind !== "task" || nodes[line.index]) continue
    const spec = specOf(catalog, line.task)
    if (!spec) {
      issues[line.index] = ["작업 목록에 없는 작업입니다. 작업 목록을 새로고침해 주세요."]
      continue
    }
    const run = runOf.get(line.index)
    const lines = run ? run.lines.map((i) => parsed.lines[i]) : [line]
    let task = makeInstance(spec, catalog, prefs)
    const count = next.tasks.filter((t) => t.task === spec.name).length
    if (count) task.label = (spec.taskName || spec.name) + " " + (count + 1)
    task = applyParsedLine(task, spec, catalog, line)
    if (run?.split) {
      task.draft = { ...task.draft, split: run.split }
      if (run.output && run.root) {
        if (spec.adapter === "generic") task.draft.outputs = { ...task.draft.outputs, [run.output]: run.root }
        else task.draft.output = { ...task.draft.output, name: run.root }
      }
    }
    for (const l of lines) nodes[l.index] = task.id
    created.push({ task, lines, run })
    next = { ...next, tasks: [...next.tasks, task] }
  }
  // Which labels each node makes, to tell a whole merged node from part of one.
  const makes = new Map<string, Set<string>>()
  for (const { task, lines } of created)
    makes.set(task.id, new Set(lines.flatMap((l) => Object.values(l.outputs ?? {}).flatMap((o) => o.labels))))
  for (const { task, lines } of created) {
    const spec = specOf(catalog, task.task)!
    for (const slot of connectionRoles(spec, catalog)) {
      const items = lines.flatMap((l) => lineItems(l, slot.name, rows))
      if (!items.length) continue
      const ids = [...new Set(items.filter((i) => !i.key.startsWith("out:") && !i.key.startsWith("missing:")).map((i) => i.key))]
      const sources: Source[] = []
      const taken = new Map<string, Set<string>>()
      for (const { item } of items) {
        if (!item.from) continue
        const source = nodes[item.from.line]
        if (!source) continue
        const sourceSpec = specOf(catalog, next.tasks.find((t) => t.id === source)?.task)
        const outputRole = sourceSpec?.adapter === "generic" ? item.from.role : undefined
        if (!taken.has(source)) {
          taken.set(source, new Set())
          sources.push({ kind: "pending", taskId: source, ...(outputRole ? { outputRole } : {}) })
        }
        taken.get(source)!.add(item.from.label)
      }
      for (const [source, labels] of taken)
        if (labels.size < (makes.get(source)?.size ?? 0) && created.find((c) => c.task.id === source)?.run)
          for (const l of lines) (issues[l.index] ??= []).push(`${slot.name}: 합친 노드의 결과 중 일부만 받습니다.`)
      if (ids.length) next = connect(next, task.id, slot.name, { kind: "files", ids, label: slot.label }, true)
      for (const source of sources) next = connect(next, task.id, slot.name, source, true)
    }
  }
  return {
    map: normalizeFileInputs(next, catalog, rows),
    nodes,
    added: created.map((c) => c.task.id),
    issues,
  }
}

/**
 * Lays out the nodes `before` did not have (the new ones and their file
 * nodes) with the auto layout, left to right, below what was there.
 */
export async function placeCommandNodes(before: TaskMap, after: TaskMap, catalog: Catalog, rows: Frame[]): Promise<TaskMap> {
  const old = new Set(before.tasks.map((t) => t.id))
  const fresh = after.tasks.filter((t) => !old.has(t.id))
  if (!fresh.length) return after
  const ids = new Set(fresh.map((t) => t.id))
  const sub: TaskMap = {
    ...emptyMap(),
    tasks: fresh,
    connections: after.connections.filter((c) => ids.has(c.target) && (c.source.kind === "files" || !c.source.taskId || ids.has(c.source.taskId))),
  }
  const laid = await autoLayoutMap(sub, catalog, rows)
  const placed = before.tasks.flatMap((t) => (t.position ? [t.position] : []))
  const top = placed.length ? Math.max(...placed.map((p) => p.y)) + 320 : 40
  const left = placed.length ? Math.min(...placed.map((p) => p.x)) : 40
  const minX = Math.min(...laid.tasks.map((t) => t.position?.x ?? 0))
  const minY = Math.min(...laid.tasks.map((t) => t.position?.y ?? 0))
  const position = new Map(laid.tasks.map((t) => [t.id, { x: (t.position?.x ?? 0) - minX + left, y: (t.position?.y ?? 0) - minY + top }]))
  return { ...after, tasks: after.tasks.map((t) => (position.has(t.id) ? { ...t, position: position.get(t.id)! } : t)) }
}
