import { createContext } from "react"
import { type Connection as FlowConnection, type Edge } from "@xyflow/react"
import { type Diagnostic } from "@/lib/diagnostics"
import { connectionFeedback } from "@/lib/workflow-flow"

import type { TaskMapViewProps } from "./types"
type NodeContext = Pick<
  TaskMapViewProps,
  "map" | "catalog" | "rows" | "onInput" | "duplicate"
> & {
  validateConnection: (
    connection: FlowConnection
  ) => ReturnType<typeof connectionFeedback>
  currentIssues: Diagnostic[]
  edges: Edge[]
  selectingGroup: boolean
  dragPreview: { entering?: string; leaving?: string }
  editGroup: (id: string) => void
  beginEdit?: () => void
  endEdit?: () => void
  runGroup?: (id: string) => void
  groupRunDisabled?: boolean
  choose: (id: string) => void
}
export const WorkflowContext = createContext<NodeContext | null>(null)
