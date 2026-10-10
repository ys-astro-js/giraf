import type { PickerRequest } from "./FilePicker"
import { acceptsAsset, jobTitle } from "@/lib/workbench"
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { defaultFileFilters, filterFiles, matchesFileName } from "@/lib/file-library"
import {
  emptyHighlight,
  folderName,
  groupRuns,
  step,
  visit,
  type Highlight,
  type History,
} from "@/lib/file-picker"
import { api, type Frame, type Job, type Workspace } from "@/lib/workbench"
type Browse = {
  path: string
  parent: string
  breadcrumbs: { name: string; path: string }[]
  shortcuts: { name: string; path: string }[]
  directories: { name: string; path: string }[]
  files: Frame[]
}

/** The run results place in the picker's history, beside folder paths. */
export const RESULTS = ":results"

export function useFilePicker({
  workspace,
  request,
  remember,
  rows,
  jobs,
}: {
  workspace: Workspace
  request: PickerRequest
  remember: (rows: Frame[]) => void
  rows: Frame[]
  jobs: Job[]
}) {
  const start = request.startPath || workspace.folder
  const [history, setHistory] = useState<History>({
    entries: [start],
    index: 0,
  })
  const place = history.entries[history.index]
  const results = place === RESULTS
  // The folder shown last stays loaded while the run results are shown.
  const path =
    history.entries
      .slice(0, history.index + 1)
      .findLast((entry) => entry !== RESULTS) ?? start
  const [browseAttempt, setBrowseAttempt] = useState(0)
  const key = `${browseAttempt}:${path}`
  // What the last browse answered, and for which path and attempt.
  const [loaded, setLoaded] = useState<{
    key: string
    data: Browse | null
    error: string
  }>({ key: "", data: null, error: "" })
  const [shortcuts, setShortcuts] = useState<Browse["shortcuts"]>([])
  const busy = loaded.key !== key
  // A failed path shows no list: a stale one would read as that folder.
  const data = busy && loaded.error ? null : loaded.data
  const error = busy ? "" : loaded.error
  const [query, setQuery] = useState(""),
    [filters, setFilters] = useState(defaultFileFilters),
    [chosen, setChosen] = useState<string[]>(request.initial)
  const [left, setLeft] = useState<Highlight>(emptyHighlight),
    [right, setRight] = useState<Highlight>(emptyHighlight)
  const [preview, setPreview] = useState<Frame | null>(null),
    [shownText, setShownText] = useState({ id: "", text: "" })
  const text = shownText.id === preview?.id ? shownText.text : ""
  const rememberRef = useRef(remember)
  useLayoutEffect(() => {
    rememberRef.current = remember
  })
  useEffect(() => {
    let cancelled = false
    api<Browse>("browse?path=" + encodeURIComponent(path))
      .then((next) => {
        if (cancelled) return
        setLoaded({ key, data: next, error: "" })
        setShortcuts(next.shortcuts)
        rememberRef.current(next.files)
      })
      .catch((e) => {
        if (!cancelled) setLoaded({ key, data: null, error: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [path, key])
  useEffect(() => {
    let cancelled = false
    if (preview && ["text", "image-list"].includes(preview.asset || ""))
      api<{ text: string }>("text?id=" + preview.id)
        .then((r) => {
          if (!cancelled) setShownText({ id: preview.id, text: r.text })
        })
        .catch((e) => {
          if (!cancelled) setShownText({ id: preview.id, text: e.message })
        })
    return () => {
      cancelled = true
    }
  }, [preview])

  const accepts = (file: Frame) =>
    acceptsAsset(request.slot.kind, file.asset) && !file.error
  const products = useMemo(() => jobs.flatMap((job) => job.products), [jobs])
  const lookup = useMemo(
    () =>
      new Map(
        [...rows, ...products, ...(data?.files || [])].map((r) => [r.id, r])
      ),
    [rows, products, data]
  )
  const files = request.folderOnly
    ? (data?.files || []).filter((file) => matchesFileName(file, query))
    : filterFiles((data?.files || []).filter(accepts), query, filters)
  const directories = (data?.directories || []).filter((d) =>
    matchesFileName({ id: d.path, label: d.name }, query)
  )
  const runs = groupRuns(
    jobs,
    (file) => accepts(file) && filterFiles([file], query, filters).length > 0
  )
  const bands = [
    ...new Set(
      [...rows, ...products, ...(data?.files || [])]
        .map((file) => file.filter)
        .filter((band): band is string => !!band)
    ),
  ].sort()
  const hasFilters =
    filters.kind !== "all" ||
    filters.band !== "all" ||
    !!(filters.minExposure || filters.maxExposure)

  /** Where a chosen file comes from: its folder, or the run that made it. */
  function origin(file: Frame | undefined) {
    if (!file) return ""
    const job = file.job && jobs.find((j) => j.id === file.job)
    if (job) return `${jobTitle(job)} 실행 결과`
    return folderName(file.path)
  }

  function go(next: History) {
    setHistory(next)
    setQuery("")
    setLeft(emptyHighlight)
    setPreview(null)
  }
  function navigate(target: string) {
    if (target === path && !results) setBrowseAttempt((v) => v + 1)
    go(visit(history, target))
  }

  return {
    error: results ? "" : error,
    busy: !results && busy,
    data,
    path,
    place,
    results,
    shortcuts,
    navigate,
    back: history.index > 0 ? () => go(step(history, -1)) : undefined,
    forward:
      history.index < history.entries.length - 1
        ? () => go(step(history, 1))
        : undefined,
    reload: () => setBrowseAttempt((v) => v + 1),
    query,
    setQuery,
    filters,
    setFilters,
    hasFilters,
    bands,
    files,
    directories,
    runs,
    chosen,
    setChosen,
    lookup,
    origin,
    left,
    setLeft,
    right,
    setRight,
    preview,
    setPreview,
    text,
  }
}
