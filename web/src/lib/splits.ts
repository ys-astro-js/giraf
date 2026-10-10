/**
 * 나눠서 실행 (docs/node-schema.md): a task splits ONE of its file-list inputs
 * into groups and runs IRAF once per group (giraf/splits.py runs it). Saved
 * on the task's draft:
 *
 *   split        {input, by: [part]}; part {key} | {per} | {each: true}
 *   pairing      {<input>: rule}; rule {by} | {order} | {iraf} | {manual: {<group id>: <file id>}}
 *   groupValues  {<parameter>: {<group id>: value}}
 *   formulas     {<parameter>: <IRAF expression of the task's other parameters>}
 *
 * Groups here are read from the headers the file list holds (Frame.headers);
 * the server reads the files themselves. Both name groups the same way, so a
 * group's id keys its values and its manual pairing.
 */
import type { Instance, TaskMap } from "./task-map/model"
import { assigned } from "./task-map/inputs"
import { evaluateExpression } from "./expression"
import type { Frame } from "./workbench"

export type SplitPart = { key: string } | { per: number } | { each: true }
export type SplitSettings = { input: string; by: SplitPart[] }
export type PairRule = { by: string } | { order: true } | { iraf: true } | { manual: Record<string, string> }
type PartKind = "key" | "per" | "each"
export type SplitGroup = {
  /** Each part's value joined by `/`: `15/1`, `B`, `m67b`. */
  id: string
  /** As people read it: a chunk is the files it takes, `15 1–5`. */
  name: string
  /** Each part's name: the column heads of the node's group strip. */
  names: string[]
  files: string[]
  /** The header values the group was made by, which pairing reads. */
  keys: Record<string, string>
  /** What default output names take (giraf/splits.py output_suffix). */
  suffix: string
}

const number = (text: string | undefined) => {
  if (text === undefined || text.trim() === "") return undefined
  const value = Number(text)
  return Number.isFinite(value) ? value : undefined
}

/** A header value as people read it and output names take it: `15.0` is `15`. */
export function passValue(text: string): string {
  const value = number(text)
  return value !== undefined && Number.isInteger(value) ? String(value) : text.trim()
}

/** Header values compare as numbers when both read as one (15 is 15.0), else as trimmed text. */
export function sameValue(a: string, b: string): boolean {
  const [x, y] = [number(a), number(b)]
  return x !== undefined && y !== undefined ? x === y : a.trim() === b.trim()
}

const naturally = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })
export const fileLabel = (frames: Map<string, Frame>, id: string) => frames.get(id)?.label || frames.get(id)?.name || id

/** A file name without what follows its first dot: `m67b.fits` is `m67b`. */
export function stem(label: string) {
  const base = label.split("/").at(-1) ?? ""
  const dot = base.indexOf(".")
  return dot > 0 ? base.slice(0, dot) : base
}

/**
 * What `files` read for a header keyword, or undefined when the list holds
 * that keyword for none of them (it was not read; the run reads it).
 */
function headerReader(ids: string[], frames: Map<string, Frame>, key: string) {
  if (!ids.some((id) => frames.get(id)?.headers?.[key] !== undefined)) return undefined
  return (id: string) => String(frames.get(id)?.headers?.[key] ?? "").trim()
}

export function outputSuffix(values: string[], kinds: PartKind[]): string {
  let text = ""
  values.forEach((value, i) => {
    const plain = value.replace(/\s+/g, "")
    text += kinds[i] === "key" || !text ? plain : `-${plain}`
  })
  return text
}

/** `Dark.fits` with `15-1` is `Dark15-1.fits`: the suffix goes before the file name's first dot. */
export function withSuffix(name: string, suffix: string): string {
  if (!suffix) return name
  const slash = name.lastIndexOf("/")
  const head = name.slice(0, slash + 1), base = name.slice(slash + 1)
  const dot = base.indexOf(".")
  return head + (dot > 0 ? base.slice(0, dot) + suffix + base.slice(dot) : base + suffix)
}

/**
 * The groups a split makes of `ids` (giraf/splits.py split_groups), or
 * undefined when a keyword is not among the headers the list holds.
 */
export function splitGroups(ids: string[], parts: SplitPart[], frames: Map<string, Frame>): SplitGroup[] | undefined {
  type Draft = { values: string[]; names: string[]; kinds: PartKind[]; files: string[]; keys: Record<string, string> }
  const ordered = [...ids].sort((a, b) => naturally(fileLabel(frames, a), fileLabel(frames, b)))
  let groups: Draft[] = [{ values: [], names: [], kinds: [], files: ordered, keys: {} }]
  for (const part of parts) {
    const refined: Draft[] = []
    for (const group of groups) {
      if ("key" in part) {
        const read = headerReader(group.files, frames, part.key)
        if (!read) return undefined
        const found: [string, string[]][] = []
        for (const id of group.files) {
          const value = passValue(read(id))
          // 15 and 15.0 are one group, named as the first file reads it.
          const into = found.find(([v]) => sameValue(v, value))
          if (into) into[1].push(id)
          else found.push([value, [id]])
        }
        const numeric = found.every(([v]) => !v || number(v) !== undefined)
        found.sort(([a], [b]) => (a === "") !== (b === "") ? (a === "" ? 1 : -1)
          : numeric ? number(a)! - number(b)! : naturally(a, b))
        for (const [value, files] of found)
          refined.push({ values: [...group.values, value], names: [...group.names, value || "없음"], kinds: [...group.kinds, "key"],
            files, keys: { ...group.keys, [part.key]: value } })
      } else if ("per" in part) {
        const size = Math.max(1, Math.floor(part.per))
        for (let start = 0; start < group.files.length; start += size) {
          const end = Math.min(start + size, group.files.length)
          refined.push({ ...group, values: [...group.values, String(start / size + 1)],
            names: [...group.names, end - start > 1 ? `${start + 1}–${end}` : String(end)], kinds: [...group.kinds, "per"],
            files: group.files.slice(start, end) })
        }
      } else
        for (const id of group.files) {
          const name = stem(fileLabel(frames, id))
          refined.push({ ...group, values: [...group.values, name], names: [...group.names, name], kinds: [...group.kinds, "each"], files: [id] })
        }
    }
    groups = refined
  }
  return groups
    .filter((g) => g.files.length || !parts.length)
    .map((g) => ({ id: g.values.join("/"), name: g.names.join(" "), names: g.names, files: g.files, keys: g.keys,
      suffix: outputSuffix(g.values, g.kinds) }))
}

export type Paired = { files: Record<string, string[]> } | { error: string; missing?: true }
export const PAIR_MISSING = "짝 맞추기를 정하세요"

/**
 * What an input with several files gives each group (giraf/splits.py
 * pair_files), or the problem that stops the run. No rule is never guessed.
 */
export function pairFiles(role: string, rule: PairRule | undefined, candidates: string[], groups: SplitGroup[], frames: Map<string, Frame>): Paired {
  if (!rule) return { error: `${role}: ${PAIR_MISSING}`, missing: true }
  const found: Record<string, string[]> = {}
  if ("by" in rule) {
    const read = (id: string) => passValue(String(frames.get(id)?.headers?.[rule.by] ?? ""))
    for (const group of groups) {
      const values = group.files.map(read)
      const value = values[0] ?? ""
      if (values.some((v) => !sameValue(v, value))) return { error: `${group.name}: 나눈 파일의 ${rule.by} 값이 서로 다릅니다.` }
      const matched = candidates.filter((id) => sameValue(read(id), value))
      if (!matched.length) return { error: `${group.name}: ${rule.by} ${value || "없음"}에 맞는 ${role} 파일이 없습니다.` }
      if (matched.length > 1) return { error: `${group.name}: ${rule.by} ${value || "없음"}에 맞는 ${role} 파일이 ${matched.length}개입니다.` }
      found[group.id] = matched
    }
    return { files: found }
  }
  if ("order" in rule) {
    if (candidates.length !== groups.length)
      return { error: `${role} 파일 ${candidates.length}개를 그룹 ${groups.length}개에 순서대로 맞출 수 없습니다.` }
    groups.forEach((group, i) => (found[group.id] = [candidates[i]]))
    return { files: found }
  }
  if ("iraf" in rule) {
    for (const group of groups) found[group.id] = [...candidates]
    return { files: found }
  }
  for (const group of groups) {
    const id = rule.manual[group.id]
    if (!id || !candidates.includes(id)) return { error: `${group.name}: ${role} 파일을 골라 주세요.` }
    found[group.id] = [id]
  }
  return { files: found }
}

/** A task's split when it is set: an input and at least one part. */
export function splitOf(task: Instance | undefined): SplitSettings | undefined {
  const split = task?.draft.split
  return split?.input && split.by?.length ? split : undefined
}

export const framesOf = (map: TaskMap, rows: Frame[]) =>
  new Map([...rows, ...map.runs.flatMap((r) => r.products)].map((f) => [f.id, f]))

/**
 * A split task's groups known now: `waiting` while the split input's source
 * has not run, `groups` undefined when its headers do not tell.
 */
export function taskGroups(map: TaskMap, task: Instance, rows: Frame[]): { groups?: SplitGroup[]; waiting: boolean } {
  const split = splitOf(task)
  if (!split) return { waiting: false }
  const { ids, pending } = assigned(map, task, split.input)
  if (pending.length) return { waiting: true }
  return { groups: splitGroups(ids, split.by, framesOf(map, rows)), waiting: false }
}

/** What each other input gives each group: one file or none goes to all; several follow the input's rule. */
export function groupInputs(map: TaskMap, task: Instance, rows: Frame[], role: string, groups: SplitGroup[]):
  { all: string[] } | Paired | { waiting: true } {
  const { ids, pending } = assigned(map, task, role)
  if (pending.length) return { waiting: true }
  if (ids.length < 2 || groups.length < 2) return { all: ids }
  return pairFiles(role, task.draft.pairing?.[role], ids, groups, framesOf(map, rows))
}

/** A formula's value for one group, reading its other parameters' `values` there (bare names). */
export function formulaValue(text: string, values: (name: string) => string | undefined): string | undefined {
  const value = evaluateExpression(text, values)
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined
  return String(Math.round(value * 1e6) / 1e6)
}

/** A task's output name in a group: a single output's name with the group's suffix. */
export const groupOutputName = (name: string, group: SplitGroup | undefined, groups: number) =>
  group && groups > 1 && name && !name.includes("{name}") && !name.startsWith("@") && !name.includes(",") ? withSuffix(name, group.suffix) : name

/** Set or clear the split; clearing also drops what was set per group. Settles a migrated region's warning. */
export function setSplit(task: Instance, split: SplitSettings | undefined): Instance {
  const { split: _s, groupValues, ...draft } = task.draft
  void _s
  const { migrated: _m, ...rest } = task
  void _m
  return { ...rest, draft: split?.by.length ? { ...draft, split, ...(groupValues ? { groupValues } : {}) } : draft }
}

export function setPairing(task: Instance, role: string, rule: PairRule | undefined): Instance {
  const pairing = { ...task.draft.pairing }
  if (rule) pairing[role] = rule
  else delete pairing[role]
  return { ...task, draft: { ...task.draft, pairing } }
}

/** A parameter's value in each group (`그룹마다 다른 값`), or undefined to take one value for all. */
export function setGroupValues(task: Instance, key: string, values: Record<string, string> | undefined): Instance {
  const groupValues = { ...task.draft.groupValues }
  if (values) groupValues[key] = values
  else delete groupValues[key]
  return { ...task, draft: { ...task.draft, groupValues } }
}

export function setFormula(task: Instance, key: string, text: string | undefined): Instance {
  const formulas = { ...task.draft.formulas }
  if (text !== undefined) formulas[key] = text
  else delete formulas[key]
  return { ...task, draft: { ...task.draft, formulas } }
}

export const MIGRATED_MESSAGE = "이전 버전의 나누기 설정을 옮기지 못했습니다. 나누기와 짝 맞추기를 다시 정해 주세요."

/** Warnings only the editor knows: a task an older document's region was unwrapped around (lib/region-migration). */
export function splitIssues(map: TaskMap) {
  return map.tasks.flatMap((task) => task.migrated
    ? [{ id: `migrated:${task.id}`, severity: "warning" as const, message: MIGRATED_MESSAGE, nodeId: task.id, label: task.label }]
    : [])
}

/**
 * Header keywords the files hold, with their distinct values: those whose
 * value differs between files first, the rest after; `chosen` keys stay
 * listed even when the files do not hold them.
 */
export function keyChoices(ids: string[], frames: Map<string, Frame>, chosen: string[] = []): { key: string; values: string[] }[] {
  const keys: string[] = []
  for (const id of ids)
    for (const key of Object.keys(frames.get(id)?.headers ?? {})) if (!keys.includes(key)) keys.push(key)
  for (const key of chosen) if (!keys.includes(key)) keys.push(key)
  const choices = keys.map((key) => {
    const values: string[] = []
    for (const id of ids) {
      const value = passValue(String(frames.get(id)?.headers?.[key] ?? ""))
      if (value && !values.some((v) => sameValue(v, value))) values.push(value)
    }
    return { key, values: values.sort(naturally) }
  })
  return [...choices.filter((c) => c.values.length > 1), ...choices.filter((c) => c.values.length <= 1)]
}

/** Toggle a part: keys keep the order they were chosen in, then a chunk size or one group per file. */
export function toggledParts(parts: SplitPart[], part: SplitPart): SplitPart[] {
  const same = (a: SplitPart, b: SplitPart) =>
    ("key" in a && "key" in b && a.key === b.key) || ("per" in a && "per" in b) || ("each" in a && "each" in b)
  const next = parts.some((p) => same(p, part)) ? parts.filter((p) => !same(p, part))
    // A group per file leaves nothing to chunk, and the other way round.
    : [...parts.filter((p) => "key" in part || "key" in p), part]
  return [...next.filter((p) => "key" in p), ...next.filter((p) => !("key" in p))]
}

/** Per-group columns a node shows under its group chips; more groups than this read as one row. */
export const MAX_COLUMNS = 4
/** A node with group columns is wider, so each column holds a short value. */
export const SPLIT_NODE_WIDTH = 304
export const columnWidth = (columns: number) => (columns <= 2 ? 56 : columns === 3 ? 48 : 40)

/**
 * What a split task's node draws under its header: a strip of group chips
 * that head per-group columns, or for a split by two parts a small matrix
 * (rows by the first part, columns by the second, each cell its files).
 * `columns` is how many per-group columns the rows below may use (0: none).
 */
export type SplitView = {
  groups?: SplitGroup[]
  waiting: boolean
  strip?: { heads: string[]; more: number }
  matrix?: { rows: string[]; cols: string[]; cells: (number | undefined)[][] }
  columns: number
}
export function splitView(map: TaskMap, task: Instance, rows: Frame[]): SplitView | undefined {
  const split = splitOf(task)
  if (!split) return undefined
  const { groups, waiting } = taskGroups(map, task, rows)
  if (!groups?.length) return { groups, waiting, columns: 0 }
  if (split.by.length === 2) {
    // Columns by the second part's value: a chunk's number, named by its files when every row's agree (`1–5`).
    const part = (g: SplitGroup, i: number) => g.id.split("/")[i]
    const rowIds = [...new Set(groups.map((g) => part(g, 0)))]
    const colIds = [...new Set(groups.map((g) => part(g, 1)))]
    const names = (i: number, ids: string[]) => {
      const each = ids.map((id) => [...new Set(groups.filter((g) => part(g, i) === id).map((g) => g.names[i]))])
      return each.every((n) => n.length === 1) ? each.map((n) => n[0]) : ids
    }
    const cells = rowIds.map((r) => colIds.map((c) => groups.find((g) => part(g, 0) === r && part(g, 1) === c)?.files.length))
    return { groups, waiting, matrix: { rows: names(0, rowIds), cols: names(1, colIds), cells }, columns: 0 }
  }
  const fits = groups.length <= MAX_COLUMNS
  return {
    groups,
    waiting,
    strip: { heads: groups.slice(0, fits ? groups.length : MAX_COLUMNS - 1).map((g) => g.name), more: fits ? 0 : groups.length },
    columns: fits && groups.length > 1 ? groups.length : 0,
  }
}

/**
 * A split task's output name as its first group names it (`Dark15-1`), for
 * an output each group names once; undefined for per-file, passed and
 * edited outputs, which keep their per-file names.
 */
export function firstOutputName(task: Instance, spec: import("./workbench").Spec | undefined, role: string | undefined, group: SplitGroup | undefined, groups: number): string | undefined {
  if (!spec || !group || groups < 2) return undefined
  if (spec.adapter === "generic") {
    const slot = spec.outputs?.find((s) => s.name === role) ?? spec.outputs?.[0]
    if (!slot) return undefined
    const mode = slot.eachWhen ? (task.draft.parameters[slot.eachWhen] === "yes" ? "each" : "single") : slot.mode
    const name = task.draft.outputs?.[slot.name] ?? slot.default
    return mode && ["each", "pass", "edit"].includes(mode) || !name ? undefined : groupOutputName(name, group, groups)
  }
  if (!spec.output || ["each", "edit"].includes(spec.output.mode)) return undefined
  return groupOutputName(task.draft.output.name || spec.output.default, group, groups)
}
