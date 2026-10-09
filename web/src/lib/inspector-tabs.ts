/**
 * The inspector's tabs for a node: only those with something to show for its
 * kind, so the tab bar reads as what the node can do.
 */
import { isFlowSpec } from "./containers"
import { isJobNode } from "./values"
import type { Instance } from "./task-map"
import type { Spec } from "./workbench"

export const INSPECTOR_TABS = ["info", "input", "output", "dependencies", "settings"] as const
export type InspectorTab = (typeof INSPECTOR_TABS)[number]

const VALUE_ROWS = new Set(["value-constant", "value-header", "value-compute"])

/**
 * 정보 always shows: it holds the node's errors and its duplicate and delete
 * actions. 의존성 always has the node itself. 출력 is for nodes that run and
 * leave files; value nodes hand values on and containers hand on their
 * members' results. 설정 needs parameters or the kind's own settings.
 */
export function inspectorTabs(spec: Spec, task: Pick<Instance, "draft">): InspectorTab[] {
  const settings =
    spec.parameters.length > 0 ||
    !!spec.parameterSets?.length ||
    !!spec.preprocess ||
    spec.adapter !== "generic" ||
    VALUE_ROWS.has(spec.run ?? "") ||
    (spec.run === "pset" && !!task.draft.pset) ||
    (isFlowSpec(spec) && spec.run !== "foreach")
  const shown: Record<InspectorTab, boolean> = {
    info: true,
    input: spec.inputs.length > 0,
    output: isJobNode(spec),
    dependencies: true,
    settings,
  }
  return INSPECTOR_TABS.filter((tab) => shown[tab])
}
