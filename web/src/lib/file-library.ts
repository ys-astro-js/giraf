import type { Frame } from "./workbench"

export type FileFilters = {
  kind: string
  band: string
  minExposure: string
  maxExposure: string
}
export const defaultFileFilters: FileFilters = {
  kind: "all",
  band: "all",
  minExposure: "",
  maxExposure: "",
}

export function partitionFiles(files: Frame[]) {
  // A scanned file takes precedence when the user opens a run's output directory.
  const unique = new Map<string, Frame>()
  for (const file of files) {
    if (!unique.has(file.id) || !file.job) unique.set(file.id, file)
  }
  const folder: Frame[] = [],
    runs = new Map<string, Frame[]>()
  for (const file of unique.values()) {
    if (!file.job) folder.push(file)
    else runs.set(file.job, [...(runs.get(file.job) || []), file])
  }
  return {
    folder,
    runs: [...runs]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([id, files]) => ({ id, files })),
  }
}

export function exposureError(filters: FileFilters) {
  const values = [filters.minExposure, filters.maxExposure]
  if (
    values.some(
      (v) => v.trim() && (!Number.isFinite(Number(v)) || Number(v) < 0)
    )
  )
    return "노출시간은 0 이상의 숫자로 입력해 주세요."
  if (values.every((v) => v.trim()) && Number(values[0]) > Number(values[1]))
    return "최소 노출시간을 최대값 이하로 입력해 주세요."
  return ""
}

export function matchesFileName(file: Frame, query: string) {
  const normalize = (value: string) =>
    value.normalize("NFKC").toLocaleLowerCase()
  return normalize(file.label).includes(normalize(query.trim()))
}

export function filterFiles(
  files: Frame[],
  query: string,
  filters: FileFilters
) {
  if (exposureError(filters)) return []
  const hasMin = !!filters.minExposure.trim(),
    hasMax = !!filters.maxExposure.trim()
  return files.filter(
    (file) =>
      (filters.kind === "all" || file.detected_kind === filters.kind) &&
      (filters.band === "all" || file.filter === filters.band) &&
      (!(hasMin || hasMax) ||
        (typeof file.exposure === "number" &&
          Number.isFinite(file.exposure) &&
          (!hasMin || file.exposure >= Number(filters.minExposure)) &&
          (!hasMax || file.exposure <= Number(filters.maxExposure)))) &&
      matchesFileName(file, query)
  )
}

export function hiddenSelectionCount(selected: string[], shown: Set<string>) {
  return [...new Set(selected)].filter((id) => !shown.has(id)).length
}

export function toggleFileSelection(
  selected: string[],
  id: string,
  checked: boolean
) {
  return checked
    ? [...new Set([...selected, id])]
    : [...new Set(selected)].filter((value) => value !== id)
}

export function runLabel(id: string) {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-(.+)$/.exec(id)
  return match
    ? `${match[1]}.${match[2]}.${match[3]} ${match[4]}:${match[5]}:${match[6]}`
    : id
}
