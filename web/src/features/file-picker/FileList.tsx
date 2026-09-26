import { FolderOpen, FileImage } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import { Skeleton } from "@/components/ui/skeleton"
import { type Frame, type Slot } from "@/lib/workbench"
import { Blank } from "@/components/workbench-controls"
import type * as React from "react"
type PickerRequest = {
  slot: Slot
  initial: string[]
  apply: (ids: string[]) => void
  folderOnly?: boolean
  applyFolder?: (path: string) => void
}

export function PickerFileList({
  busy,
  request,
  list,
  selection,
  setSelection,
  directories,
  navigate,
  select,
  setPreview,
  query,
  hasFilters,
  tab,
}: {
  busy: boolean
  request: PickerRequest
  list: Frame[]
  selection: Set<string>
  setSelection: React.Dispatch<React.SetStateAction<Set<string>>>
  directories: { name: string; path: string }[]
  navigate: (path: string) => void
  select: (id: string, checked: boolean, shift?: boolean) => void
  setPreview: React.Dispatch<React.SetStateAction<Frame | null>>
  query: string
  hasFilters: boolean
  tab: string
}) {
  return (
    <div className="picker-list" tabIndex={0} aria-label="파일 목록">
      {busy ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              {!request.folderOnly && (
                <TableHead className="w-10">
                  {request.slot.multiple ? (
                    <Checkbox
                      aria-label="표시된 파일 전체 선택"
                      checked={
                        list.length > 0 &&
                        list.every((r) => selection.has(r.id))
                      }
                      indeterminate={
                        list.some((r) => selection.has(r.id)) &&
                        !list.every((r) => selection.has(r.id))
                      }
                      disabled={!list.length}
                      onCheckedChange={(checked) =>
                        setSelection((s) => {
                          const next = new Set(s)
                          for (const r of list)
                            checked ? next.add(r.id) : next.delete(r.id)
                          return next
                        })
                      }
                    />
                  ) : (
                    <span className="sr-only">선택</span>
                  )}
                </TableHead>
              )}
              <TableHead>이름</TableHead>
              {!request.folderOnly && (
                <>
                  <TableHead>필터</TableHead>
                  <TableHead>
                    <span className="flex items-baseline gap-2">
                      노출 시간{" "}
                      <span className="text-muted-foreground">초</span>
                    </span>
                  </TableHead>
                </>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {directories.map((d) => (
              <TableRow key={d.path}>
                <TableCell colSpan={request.folderOnly ? 1 : 4}>
                  <Button variant="ghost" onClick={() => navigate(d.path)}>
                    <FolderOpen data-icon="inline-start" />
                    <span className="picker-filename">{d.name}</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {!request.folderOnly &&
              list.map((r) => (
                <TableRow
                  key={r.id}
                  data-state={selection.has(r.id) ? "selected" : undefined}
                >
                  <TableCell>
                    <Checkbox
                      aria-label={`${r.label} 선택`}
                      checked={selection.has(r.id)}
                      onCheckedChange={(checked, details) =>
                        select(
                          r.id,
                          checked,
                          Boolean((details.event as MouseEvent).shiftKey)
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      aria-label={`${r.label} 미리보기`}
                      onClick={() => setPreview(r)}
                    >
                      <FileImage data-icon="inline-start" />
                      <span className="picker-filename" title={r.label}>
                        {r.label}
                      </span>
                    </Button>
                  </TableCell>
                  <TableCell>{r.filter || "—"}</TableCell>
                  <TableCell>{r.exposure ?? "—"}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      )}
      {!busy && !list.length && !directories.length && (
        <Blank>
          {query || hasFilters
            ? query
              ? "검색 결과 없음"
              : "필터에 맞는 파일 없음"
            : tab === "selection"
              ? "선택한 파일 없음"
              : tab === "results"
                ? "실행 결과 없음"
                : "빈 폴더"}
        </Blank>
      )}
    </div>
  )
}
