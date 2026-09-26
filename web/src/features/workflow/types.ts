import { type Catalog, type Frame } from "@/lib/workbench"
import { type TaskMap, type Source } from "@/lib/task-map"

export type TaskMapViewProps = {
  search?: string
  onSearch?: (value: string) => void
  revealNode?: { id: string; revision: number }
  layoutRevision?: number
  onAutoLayout?: () => void
  onStraightEdges?: () => void
  layoutBusy?: boolean
  map: TaskMap
  catalog: Catalog
  rows: Frame[]
  update: (fn: (m: TaskMap) => TaskMap, label?: string) => void
  onEditStart?: () => void
  onEditEnd?: () => void
  add: () => void
  link: (target?: string, source?: Source) => void
  open: (r: Frame) => void
  removeLink: (id: string) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  onSelect?: () => void
  onInput?: (id: string, role: string) => void
  onRunSubflow?: (id: string) => void
  workflowBusy?: boolean
  runDisabled?: boolean
  revealConnection?: { id: string; revision: number }
}
