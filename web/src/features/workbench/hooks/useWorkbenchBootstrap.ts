import { initialPreferences } from "@/features/workbench/types"
import { useQuery } from "@tanstack/react-query"
import { useEffect } from "react"
import {
  api,
  defaults,
  type Catalog,
  type Preferences,
  type Frame,
  type Workspace,
  type Job,
} from "@/lib/workbench"
import { reconcileRuns, migrateMap, type TaskMap } from "@/lib/task-map"
import type * as React from "react"

export function useWorkbenchBootstrap({
  loadAttempt,
  ready,
  loadFailure,
  setCatalog,
  setSaveState,
  replacePreferences,
  setMap,
  queueSave,
  setWorkspace,
  setJobs,
  remember,
  setReady,
}: {
  loadAttempt: number
  ready: boolean
  loadFailure: boolean
  setCatalog: React.Dispatch<React.SetStateAction<Catalog | null>>
  setSaveState: React.Dispatch<React.SetStateAction<string>>
  replacePreferences: (value: Preferences) => void
  setMap: (map: TaskMap) => void
  queueSave: () => void
  setWorkspace: React.Dispatch<React.SetStateAction<Workspace>>
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>
  remember: (rows: Frame[]) => void
  setReady: React.Dispatch<React.SetStateAction<boolean>>
}) {
  // Hydrate the editable document once; background queries must never reset edits.
  const bootstrap = useQuery({
    queryKey: ["workbench-bootstrap", loadAttempt],
    enabled: !ready,
    staleTime: Infinity,
    gcTime: 0,
    queryFn: ({ signal }) =>
      Promise.all([
        api<Catalog>("catalog", undefined, signal),
        api<Preferences & { files: Frame[] }>(
          "task-preferences",
          undefined,
          signal
        ),
        api<Workspace>("workspace", undefined, signal),
        api<Job[]>("jobs", undefined, signal),
      ]),
  })
  const loadError = loadFailure || bootstrap.isError
  useEffect(() => {
    if (ready || !bootstrap.data || loadError) return
    const [c, p, w, j] = bootstrap.data
    let recovered = p
    try {
      const pending = localStorage.getItem("giraf-pending-draft")
      if (pending) {
        const recovery = JSON.parse(pending)
        if (recovery._document?.path === p._document?.path) {
          recovered = recovery
        }
      }
    } catch {
      /* Ignore a malformed browser recovery copy. */
    }
    const pref = {
      ...initialPreferences,
      ...recovered,
      drafts: recovered.drafts || {},
      packageValues: { ...defaults(c.ccdred), ...recovered.packageValues },
    }
    // The server snapshot initializes the independently editable document once.
    setCatalog(c)
    setSaveState(
      pref._document?.saved ? "저장됨" : "작업을 추가하면 자동 저장됩니다"
    )
    replacePreferences(pref)
    setMap(reconcileRuns(migrateMap(pref, c), j))
    if (recovered !== p) queueSave()
    setWorkspace(w)
    setJobs(j)
    remember([
      ...(p.files || []),
      ...w.files,
      ...j.flatMap((j) => j.products || []),
    ])
    setReady(true)
  }, [
    bootstrap.data,
    ready,
    loadError,
    remember,
    setMap,
    replacePreferences,
    queueSave,
    setCatalog,
    setJobs,
    setReady,
    setSaveState,
    setWorkspace,
  ])

  return { loadError }
}
