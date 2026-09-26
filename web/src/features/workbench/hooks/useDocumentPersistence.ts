import { createEditorStore } from "@/lib/edit-history"
import { createDocumentAutosave } from "@/lib/document-autosave"
import { useCallback, useEffect, useRef, useState } from "react"
import { api, type Preferences } from "@/lib/workbench"
import type * as React from "react"
import type { Instance } from "@/lib/task-map"

export function useDocumentPersistence({
  prefs,
  setPrefs,
  setSaveState,
  setError,
  editor,
}: {
  prefs: Preferences
  setPrefs: React.Dispatch<React.SetStateAction<Preferences>>
  setSaveState: React.Dispatch<React.SetStateAction<string>>
  setError: React.Dispatch<React.SetStateAction<string>>
  editor: ReturnType<typeof createEditorStore>
}) {
  const prefsRef = useRef(prefs)
  const replacePreferences = useCallback(
    (value: Preferences) => {
      prefsRef.current = value
      setPrefs(value)
    },
    [setPrefs]
  )
  const [autosave] = useState(() =>
    createDocumentAutosave<Preferences>({
      save: async (value) => {
        await api("task-preferences", value)
      },
      writeRecovery: (value) =>
        localStorage.setItem("giraf-pending-draft", JSON.stringify(value)),
      clearRecovery: () => localStorage.removeItem("giraf-pending-draft"),
      onSaved: () => setSaveState("저장됨"),
      onError: (error) => {
        setSaveState("저장 실패")
        setError((error as Error).message)
      },
    })
  )
  const queueSave = useCallback(() => {
    setSaveState("저장 중")
    autosave.schedule({ ...prefsRef.current, taskMap: editor.getMap() })
  }, [autosave, editor, setSaveState])
  const finishEdit = useCallback(() => {
    editor.endEdit()
    void autosave.flush().catch(() => {})
  }, [autosave, editor])
  function saveTaskDefaults(task: Instance) {
    const current = prefsRef.current
    replacePreferences({
      ...current,
      drafts: {
        ...current.drafts,
        [task.task]: structuredClone(task.draft),
        ccdproc: structuredClone(
          task.task === "ccdproc" ? task.draft : task.preprocess
        ),
      },
      parameterSets: {
        ...current.parameterSets,
        [task.task]: structuredClone(task.parameterSets || {}),
      },
      mapping: { ...task.mapping },
      packageValues: { ...task.packageValues },
      instrument: [...task.instrument],
    })
    queueSave()
    setSaveState("새 작업에 적용할 설정 저장 중")
  }
  useEffect(() => {
    const flushRecovery = () => autosave.flushRecovery()
    const hide = () => {
      if (document.visibilityState === "hidden") flushRecovery()
    }
    window.addEventListener("pagehide", flushRecovery)
    document.addEventListener("visibilitychange", hide)
    return () => {
      window.removeEventListener("pagehide", flushRecovery)
      document.removeEventListener("visibilitychange", hide)
      autosave.dispose()
    }
  }, [autosave])

  return {
    replacePreferences,
    queueSave,
    prefsRef,
    autosave,
    finishEdit,
    saveTaskDefaults,
  }
}
