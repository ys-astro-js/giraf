import type { PickerRequest } from "./FilePicker"
import { acceptsAsset } from "@/lib/workbench"
import { useEffect, useMemo, useRef, useState } from "react"
import { defaultFileFilters, filterFiles } from "@/lib/file-library"
import { api, type Frame, type Workspace } from "@/lib/workbench"
type Browse = {
  path: string
  parent: string
  breadcrumbs: { name: string; path: string }[]
  shortcuts: { name: string; path: string }[]
  directories: { name: string; path: string }[]
  files: Frame[]
}

export function useFilePicker({
  workspace,
  request,
  remember,
  rows,
}: {
  workspace: Workspace
  request: PickerRequest
  remember: (rows: Frame[]) => void
  rows: Frame[]
}) {
  const [location, setLocation] = useState(workspace.folder)
  const [path, setPath] = useState(workspace.folder),
    [data, setData] = useState<Browse | null>(null),
    [busy, setBusy] = useState(true),
    [error, setError] = useState("")
  const [tab, setTab] = useState("folder"),
    [query, setQuery] = useState(""),
    [filters, setFilters] = useState(defaultFileFilters),
    [selection, setSelection] = useState(new Set(request.initial))
  const [preview, setPreview] = useState<Frame | null>(null),
    [text, setText] = useState("")
  const [browseAttempt, setBrowseAttempt] = useState(0)
  const last = useRef(""),
    rememberRef = useRef(remember)
  rememberRef.current = remember
  useEffect(() => {
    let cancelled = false
    setBusy(true)
    setError("")
    api<Browse>("browse?path=" + encodeURIComponent(path))
      .then((next) => {
        if (cancelled) return
        setData(next)
        rememberRef.current(next.files)
        setBusy(false)
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e.message)
          setBusy(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [path, browseAttempt])
  useEffect(() => {
    let cancelled = false
    setText("")
    if (preview && ["text", "image-list"].includes(preview.asset || ""))
      api<{ text: string }>("text?id=" + preview.id)
        .then((r) => {
          if (!cancelled) setText(r.text)
        })
        .catch((e) => {
          if (!cancelled) setError(e.message)
        })
    return () => {
      cancelled = true
    }
  }, [preview])
  const lookup = useMemo(
    () => new Map([...rows, ...(data?.files || [])].map((r) => [r.id, r])),
    [rows, data]
  )
  const list = useMemo(() => {
    const source =
      tab === "folder"
        ? data?.files || []
        : tab === "results"
          ? rows.filter((r) => r.job)
          : [...selection]
              .map((id) => lookup.get(id))
              .filter((r): r is Frame => !!r)
    return filterFiles(
      source.filter(
        (r) => acceptsAsset(request.slot.kind, r.asset) && !r.error
      ),
      query,
      filters
    )
  }, [tab, data, rows, selection, lookup, request.slot.kind, filters, query])
  const bands = [
    ...new Set(
      [...rows, ...(data?.files || [])]
        .map((file) => file.filter)
        .filter((band): band is string => !!band)
    ),
  ].sort()
  const hasFilters =
    filters.kind !== "all" ||
    filters.band !== "all" ||
    !!(filters.minExposure || filters.maxExposure)
  function select(id: string, checked: boolean, shift = false) {
    setSelection((current) => {
      const next = request.slot.multiple ? new Set(current) : new Set<string>()
      const a = list.findIndex((r) => r.id === last.current),
        b = list.findIndex((r) => r.id === id)
      const ids =
        shift && a >= 0 && request.slot.multiple
          ? list.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id)
          : [id]
      for (const id of ids) checked ? next.add(id) : next.delete(id)
      return next
    })
    last.current = id
  }
  function navigate(path: string) {
    setLocation(path)
    setPath(path)
    setQuery("")
    setTab("folder")
    setPreview(null)
  }
  const directories = tab === "folder" && !query ? data?.directories || [] : []

  return {
    error,
    setBrowseAttempt,
    navigate,
    location,
    busy,
    data,
    setLocation,
    tab,
    setTab,
    setQuery,
    setFilters,
    selection,
    query,
    filters,
    bands,
    list,
    setSelection,
    preview,
    setPreview,
    directories,
    select,
    hasFilters,
    text,
  }
}
