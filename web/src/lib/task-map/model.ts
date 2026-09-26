import { type CustomOutputPort } from "@/lib/output-ports"
import type { CalibrationGroup } from "@/lib/calibration-ports"
import {
  defaults,
  makeDraft,
  type Catalog,
  type Draft,
  type Frame,
  type Preferences,
  type Spec,
  type Values,
} from "@/lib/workbench"
const clone = <T,>(value: T): T => structuredClone(value)

export type Source = {
  files?: string[]
  group?: CalibrationGroup
  port?: string
} & (
  | { kind: "files"; ids: string[]; label: string }
  | {
      kind: "result"
      outputRole?: string
      taskId?: string
      runId: string
      ids: string[]
      label?: string
    }
  | { kind: "pending"; taskId: string; outputRole?: string }
)

export type Connection = {
  targetGroup?: CalibrationGroup
  id: string
  target: string
  role: string
  source: Source
}

export type Instance = {
  outputPorts?: CustomOutputPort[]
  parameterSets?: Record<string, Values>
  id: string
  task: string
  label: string
  description?: string
  draft: Draft
  preprocess: Draft
  mapping: Values
  instrument: string[]
  packageValues: Values
  backend: string
  expressions: Record<string, string>
  filePolicy: { mode: "copy" | "direct"; backup: boolean }
  position?: { x: number; y: number }
  collapsed?: boolean
  subflowId?: string
}

export type MapRun = {
  id: string
  instanceId: string
  state: string
  products: Frame[]
}

export type SubflowColor =
  "teal" | "blue" | "violet" | "amber" | "rose" | "slate"

export type Subflow = {
  color?: SubflowColor
  id: string
  name: string
  position: { x: number; y: number }
  width: number
  height: number
}

export type TaskMap = {
  edgeRoutes?: Record<
    string,
    {
      source: string
      target: string
      sourceHandle?: string | null
      targetHandle?: string | null
      points: { x: number; y: number }[]
    }
  >
  subflows?: Subflow[]
  version: 1
  tasks: Instance[]
  connections: Connection[]
  runs: MapRun[]
  view: {
    selected: string
    coordinateSystem?: "react-flow"
    edgeStyle?: "default" | "smoothstep"
    mode: "map" | "list"
    zoom: number
    x: number
    y: number
    focus: boolean
  }
}

export const uid = () => crypto.randomUUID()

export const emptyMap = (): TaskMap => ({
  version: 1,
  tasks: [],
  connections: [],
  runs: [],
  view: { selected: "", mode: "map", zoom: 1, x: 0, y: 0, focus: false },
})

export function makeInstance(
  spec: Spec,
  catalog: Catalog,
  prefs: Preferences,
  id = uid()
): Instance {
  const proc = catalog.tasks.find((t) => t.name === "ccdproc")!
  const preprocess = makeDraft(proc, prefs.drafts.ccdproc)

  return clone({
    id,
    task: spec.name,
    label: spec.taskName || spec.name,
    parameterSets: Object.fromEntries(
      (spec.parameterSets || []).map((s) => [
        s.name,
        {
          ...defaults(s.parameters),
          ...prefs.parameterSets?.[spec.name]?.[s.name],
        },
      ])
    ),
    draft: makeDraft(spec, prefs.drafts[spec.name]),
    preprocess,
    mapping: prefs.mapping,
    instrument: prefs.instrument,
    packageValues: { ...defaults(catalog.ccdred), ...prefs.packageValues },
    backend: prefs.backend,
    expressions: {},
    filePolicy: { mode: "copy", backup: true },
  })
}

export function resetInstanceParameters(task: Instance, spec: Spec): Instance {
  return {
    ...task,
    draft: { ...task.draft, parameters: defaults(spec.parameters) },
    parameterSets:
      spec.adapter === "generic"
        ? Object.fromEntries(
            (spec.parameterSets || []).map((group) => [
              group.name,
              defaults(group.parameters),
            ])
          )
        : task.parameterSets,
  }
}
