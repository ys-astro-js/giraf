/**
 * One 값 node over four run components: what it takes its values from
 * (가져오기) picks the run. Switching converts the node in place; saved
 * documents and the server still see `value-constant`, `value-header`,
 * `pset` and `value-compute` nodes (giraf/schemas).
 */
import type { Instance, TaskMap } from "./task-map/model"
import type { WorkflowIssue } from "./live-diagnostics"
import { makeDraft, taskDisplayName, type Catalog, type Spec } from "./workbench"
import { withObject } from "./korean"
import { unconnectedInputs } from "./compute-form"
import {
  computeReads,
  computeVariables,
  defaultLabelSuffix,
  dropStaleLinks,
  isValueNode,
  PSET_INPUT,
  PSET_OUTPUT,
  VALUE_TITLE,
} from "./values"

type Run = NonNullable<Spec["run"]>

/** 가져오기 choices, in the order the control shows them. */
export const VALUE_MODES: { run: Run; label: string }[] = [
  { run: "value-constant", label: "직접 입력" },
  { run: "value-header", label: "파일 헤더" },
  { run: "pset", label: "작업 설정" },
  { run: "value-compute", label: "계산" },
]
/** Every 값 node shows the direct-input node's icon. */
export const VALUE_ICON = "variable"
/** A task's own package parameters, which are not a pset to share. */
export const PACKAGE_SET = "$package"

const specOf = (catalog: Catalog, task: Instance | undefined) =>
  catalog.tasks.find((s) => s.name === task?.task)

/**
 * Converts a 값 node to another 가져오기 run. The node keeps its id,
 * place and chosen label; what it held for the old run is cleared, and
 * connections to handles it no longer has are dropped. Value outputs are
 * named by rows, so their links go with the rows.
 */
export function setValueMode(map: TaskMap, catalog: Catalog, nodeId: string, run: Run): TaskMap {
  const node = map.tasks.find((t) => t.id === nodeId)
  const from = specOf(catalog, node)
  if (!node || !isValueNode(from)) throw Error("값 노드를 찾을 수 없습니다.")
  if (from!.run === run) return map
  const spec = catalog.tasks.find((s) => s.run === run && isValueNode(s))
  if (!spec) throw Error("이 가져오기 방식을 찾을 수 없습니다.")
  const suffix = defaultLabelSuffix(catalog, node)
  const task: Instance = {
    ...node,
    task: spec.name,
    label: suffix === undefined ? node.label : VALUE_TITLE + suffix,
    draft: makeDraft(spec),
    parameterSets: {},
    pinned: spec.pinned?.length ? [...spec.pinned] : undefined,
  }
  return dropStaleLinks({ ...map, tasks: map.tasks.map((t) => (t.id === nodeId ? task : t)) }, catalog, nodeId)
}

/** Tasks in the workflow a 작업 설정 node can take a pset from, with their psets. */
export function psetSources(map: TaskMap, catalog: Catalog): { task: Instance; sets: string[] }[] {
  return map.tasks.flatMap((task) => {
    const sets = (specOf(catalog, task)?.parameterSets ?? []).map((s) => s.name).filter((name) => name !== PACKAGE_SET)
    return sets.length ? [{ task, sets }] : []
  })
}

/** The first task a pset node feeds: where it took its pset from. */
export function psetUser(map: TaskMap, nodeId: string): { taskId: string; name: string } | undefined {
  const link = map.connections.find(
    (c) => c.source.kind !== "files" && c.source.taskId === nodeId && c.source.outputRole === PSET_OUTPUT
  )
  return link && { taskId: link.target, name: link.role.slice(PSET_INPUT.length) }
}

const by = (partition: string | undefined) => (partition ? `${partition}별로 ` : "")

/** The line under a 값 node's title: what it hands on, for its 가져오기. */
export function valueDescription(map: TaskMap, catalog: Catalog, task: Instance): string | undefined {
  const partition = task.draft.partition
  switch (specOf(catalog, task)?.run) {
    case "value-constant":
      return `직접 정한 값을 ${by(partition)}전달`
    case "value-header":
      return "파일 헤더의 키워드 값을 전달"
    case "value-compute":
      return `받은 값을 ${by(partition)}계산해 전달`
    case "pset": {
      const pset = task.draft.pset
      if (!pset) return "작업 설정을 여러 작업에 전달"
      const user = psetUser(map, task.id)
      const from = user && map.tasks.find((t) => t.id === user.taskId)
      const owner = from ? `${from.label || taskDisplayName(from.task)}의 ` : ""
      return `${owner}${withObject(pset.name)} 여러 작업에 전달`
    }
  }
  return undefined
}

/**
 * Warnings only the editor knows: a 작업 설정 node that holds no pset yet,
 * and a 계산 node whose rows read a value nothing is connected to.
 */
export function valueIssues(map: TaskMap, catalog: Catalog): (WorkflowIssue & { label: string })[] {
  return map.tasks.flatMap((task) => {
    const run = specOf(catalog, task)?.run
    const warn = (kind: string, message: string) =>
      [{ id: `${kind}:${task.id}`, severity: "warning" as const, message, nodeId: task.id, label: task.label }]
    if (run === "pset" && !task.draft.pset) return warn("value-source", "가져올 작업과 pset을 골라 주세요.")
    if (run !== "value-compute") return []
    const reads = computeReads(task)
    // A row with no expression has its 받은 값 still to choose.
    const unset = (task.draft.valueRows ?? []).some((r) => r.name.trim() && !r.value.trim())
    if (unconnectedInputs(map, task, reads.length || !unset ? reads : computeVariables(task)).length)
      return warn("value-input", "받은 값을 연결해 주세요.")
    if (unset) return warn("value-input", "받은 값을 골라 주세요.")
    return []
  })
}
