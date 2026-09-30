import { createContext, useContext } from "react"
import type { Workbench } from "./useWorkbenchController"

export const WorkbenchContext = createContext<Workbench | null>(null)

export function useWorkbench() {
  const workbench = useContext(WorkbenchContext)
  if (!workbench) throw new Error("useWorkbench outside WorkbenchContext")
  return workbench
}
