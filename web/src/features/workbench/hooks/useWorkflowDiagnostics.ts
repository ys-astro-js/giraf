import { diagnostics } from "@/lib/diagnostics"
import { createWorkflowDiagnosticsController } from "@/lib/live-diagnostics"
import { useEffect, useRef, useState } from "react"
import { type Catalog, type Preferences, type Workspace } from "@/lib/workbench"
import {
  workflowDiagnosticRequest,
  workflowDiagnosticSignature,
  type TaskMap,
} from "@/lib/task-map"

export function useWorkflowDiagnostics({
  map,
  workspace,
  prefs,
  ready,
  catalog,
}: {
  map: TaskMap
  workspace: Workspace
  prefs: Preferences
  ready: boolean
  catalog: Catalog | null
}) {
  const [diagnosticFailure, setDiagnosticFailure] = useState("")
  const diagnosticController = useRef<ReturnType<
    typeof createWorkflowDiagnosticsController
  > | null>(null)

  const diagnosticSignature = workflowDiagnosticSignature(map, workspace.folder)
  const documentId = prefs._document?.path || "현재 문서"
  useEffect(() => {
    const controller = createWorkflowDiagnosticsController(diagnostics)
    diagnosticController.current = controller
    const unsubscribe = controller.subscribeFailure(() =>
      setDiagnosticFailure(controller.getFailure())
    )
    return () => {
      unsubscribe()
      controller.dispose()
      diagnosticController.current = null
    }
  }, [])
  useEffect(() => {
    if (!ready || !catalog) return
    diagnosticController.current?.change(
      documentId,
      workflowDiagnosticRequest(map, catalog, workspace.folder)
    )
    // The signature excludes position, selection, zoom and other view changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticSignature, documentId, ready, catalog, diagnosticController])
  useEffect(() => {
    if (!ready) return
    const checkVisible = () => {
      if (!document.hidden) diagnosticController.current?.recheck()
    }
    const timer = setInterval(checkVisible, 3000)
    document.addEventListener("visibilitychange", checkVisible)
    window.addEventListener("focus", checkVisible)
    return () => {
      clearInterval(timer)
      document.removeEventListener("visibilitychange", checkVisible)
      window.removeEventListener("focus", checkVisible)
    }
  }, [ready, diagnosticController])

  return { diagnosticController, diagnosticFailure }
}
