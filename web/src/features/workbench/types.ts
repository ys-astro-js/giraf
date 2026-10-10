import type { Source } from "@/lib/task-map"
import type { Job, Preferences } from "@/lib/workbench"
export type LinkDialog = {
  target: string
  role: string
  source?: Source
  sourceKey: string
}
export type Origin = {
  taskId: string
  role: string
  sourceId: string
  editorId: string
}
export type Plan = {
  preview: { inputs: string[]; output: string }[]
  filePlan: {
    token: string
    destructive: boolean
    description: string
    targets: { path: string }[]
    backup: boolean
  }
  effective: unknown
}
export type WorkflowRun = {
  id: string
  state: string
  message: string
  total: number
  done: number
  currentTask: string
  jobs: (Job & { instanceId: string })[]
  currentJob: Job | null
  plan: Plan["filePlan"] | null
}
export const workflowActive = (w: WorkflowRun | null) =>
  !!w && ["running", "waiting", "confirmation", "cancelling"].includes(w.state)
export const initialPreferences: Preferences = {
  drafts: {},
  backend: "cl",
  mapping: {
    imagetyp: "IMAGETYP",
    exptime: "EXPTIME",
    darktime: "DARKTIME",
    subset: "FILTER",
  },
  instrument: [],
  packageValues: {},
}
