import { FolderOpen, FileImage, FileText } from "lucide-react"
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
import { type Frame } from "@/lib/workbench"
import { Blank } from "@/components/workbench-controls"

export type FileSelection = {
  selected: Set<string>
  multiple: boolean
  onSelect: (id: string, checked: boolean, shift: boolean) => void
  onAll: (checked: boolean) => void
}

const fileIcon = (file: Frame) =>
  ["text", "image-list"].includes(file.asset || "") ? FileText : FileImage

/**
 * A table of files: folders to go into, then files with their filter and
 * exposure. Choosing a file's name acts on it (previews it in the input
 * picker, opens it in a viewer from the toolbar); with `selection`, each
 * row also has a checkbox.
 */
export function FileTable({
  busy,
  list,
  directories = [],
  navigate,
  details = true,
  selection,
  onActivate,
  activateLabel,
  empty,
}: {
  busy: boolean
  list: Frame[]
  directories?: { name: string; path: string }[]
  navigate?: (path: string) => void
  /** Filter and exposure columns; off when only folders are listed. */
  details?: boolean
  selection?: FileSelection
  onActivate: (file: Frame) => void
  activateLabel: (file: Frame) => string
  /** What an empty list says. */
  empty: string
}) {
  const columns = (selection ? 1 : 0) + 1 + (details ? 2 : 0)
  const all = list.length > 0 && list.every((r) => selection?.selected.has(r.id))
  const some = list.some((r) => selection?.selected.has(r.id))
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
              {selection && (
                <TableHead className="w-10">
                  {selection.multiple ? (
                    <Checkbox
                      aria-label="표시된 파일 전체 선택"
                      checked={all}
                      indeterminate={some && !all}
                      disabled={!list.length}
                      onCheckedChange={(checked) => selection.onAll(checked)}
                    />
                  ) : (
                    <span className="sr-only">선택</span>
                  )}
                </TableHead>
              )}
              <TableHead>이름</TableHead>
              {details && (
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
                <TableCell colSpan={columns}>
                  <Button variant="ghost" onClick={() => navigate?.(d.path)}>
                    <FolderOpen data-icon="inline-start" />
                    <span className="picker-filename">{d.name}</span>
                  </Button>
                </TableCell>
              </TableRow>
            ))}
            {list.map((r) => {
              const Icon = fileIcon(r)
              return (
                <TableRow
                  key={r.id}
                  data-state={
                    selection?.selected.has(r.id) ? "selected" : undefined
                  }
                >
                  {selection && (
                    <TableCell>
                      <Checkbox
                        aria-label={`${r.label} 선택`}
                        checked={selection.selected.has(r.id)}
                        onCheckedChange={(checked, event) =>
                          selection.onSelect(
                            r.id,
                            checked,
                            Boolean((event.event as MouseEvent).shiftKey)
                          )
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell>
                    <Button
                      variant="ghost"
                      aria-label={activateLabel(r)}
                      onClick={() => onActivate(r)}
                    >
                      <Icon data-icon="inline-start" />
                      <span className="picker-filename" title={r.label}>
                        {r.label}
                      </span>
                    </Button>
                  </TableCell>
                  {details && (
                    <>
                      <TableCell>{r.filter || "—"}</TableCell>
                      <TableCell>{r.exposure ?? "—"}</TableCell>
                    </>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
      {!busy && !list.length && !directories.length && <Blank>{empty}</Blank>}
    </div>
  )
}
