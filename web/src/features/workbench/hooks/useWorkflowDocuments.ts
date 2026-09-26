import type { createDocumentAutosave } from "@/lib/document-autosave"
import type { createWorkflowDiagnosticsController } from "@/lib/live-diagnostics"
import { initialPreferences } from "@/features/workbench/types"
import { createEditorStore } from "@/lib/edit-history"
import { workflowDocument } from "@/lib/workflow-document"
import { type WorkflowAction } from "@/components/workflow-selector"
import { type ExecutionReference } from "@/lib/execution-status"
import {
  api,
  defaults,
  type Catalog,
  type Preferences,
  type Workspace,
  type Job,
} from "@/lib/workbench"
import {
  reconcileRuns,
  workflowDiagnosticRequest,
  migrateMap,
  type TaskMap,
} from "@/lib/task-map"
import type * as React from "react"

export function useWorkflowDocuments({
  editor,
  prefsRef,
  replacePreferences,
  queueSave,
  autosave,
  catalog,
  jobs,
  diagnosticController,
  workspace,
  setMap,
  setSaveState,
  setLastExecution,
  setSelectedFiles,
  setLayoutRevision,
  documentBusy,
  setDocumentBusy,
}: {
  editor: ReturnType<typeof createEditorStore>
  prefsRef: React.RefObject<Preferences>
  replacePreferences: (value: Preferences) => void
  queueSave: () => void
  autosave: ReturnType<typeof createDocumentAutosave<Preferences>>
  catalog: Catalog | null
  jobs: Job[]
  diagnosticController: React.RefObject<ReturnType<
    typeof createWorkflowDiagnosticsController
  > | null>
  workspace: Workspace
  setMap: (map: TaskMap) => void
  setSaveState: React.Dispatch<React.SetStateAction<string>>
  setLastExecution: React.Dispatch<
    React.SetStateAction<ExecutionReference | undefined>
  >
  setSelectedFiles: React.Dispatch<React.SetStateAction<string[]>>
  setLayoutRevision: React.Dispatch<React.SetStateAction<number>>
  documentBusy: boolean
  setDocumentBusy: React.Dispatch<React.SetStateAction<boolean>>
}) {
  async function saveDocument(name?: string) {
    editor.endEdit()
    const current = prefsRef.current
    if (name !== undefined && current._document)
      replacePreferences({
        ...current,
        _document: { ...current._document, name },
      })
    queueSave()
    await autosave.flush()
  }
  function applyDocument(value: Preferences) {
    if (!catalog) return
    autosave.reset()
    const next = {
      ...initialPreferences,
      ...value,
      drafts: value.drafts || {},
      packageValues: { ...defaults(catalog.ccdred), ...value.packageValues },
    }
    const nextMap = reconcileRuns(migrateMap(next, catalog), jobs)
    diagnosticController.current?.change(
      next._document?.path || "현재 문서",
      workflowDiagnosticRequest(nextMap, catalog, workspace.folder),
      true
    )
    replacePreferences(next)
    setMap(nextMap)
    setSaveState(
      value._document?.saved ? "저장됨" : "작업을 추가하면 자동 저장됩니다"
    )
    setLastExecution(undefined)
    setSelectedFiles([])
    setLayoutRevision((revision) => revision + 1)
  }
  async function changeDocument(action: WorkflowAction) {
    if (documentBusy) return
    setDocumentBusy(true)
    try {
      editor.endEdit()
      await autosave.flush()
      applyDocument(await api<Preferences>("workflow-documents", action))
    } finally {
      setDocumentBusy(false)
    }
  }
  function exportDocument() {
    const exported = workflowDocument(prefsRef.current, editor.getMap())
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(exported, null, 2)], {
        type: "application/json",
      })
    )
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = `${exported.name.replace(/[\\/:*?"<>|]/g, "_")}.json`
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return { applyDocument, saveDocument, changeDocument, exportDocument }
}
