import { FolderOpen, FileImage, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
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

const fileIcon = (file: Frame) =>
  ["text", "image-list"].includes(file.asset || "") ? FileText : FileImage

/**
 * A table of files: folders to go into, then files with their filter and
 * exposure. Choosing a file's name acts on it (in the toolbar's files
 * popover, opens it in a viewer).
 */
export function FileTable({
  busy,
  list,
  directories = [],
  navigate,
  details = true,
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
  onActivate: (file: Frame) => void
  activateLabel: (file: Frame) => string
  /** What an empty list says. */
  empty: string
}) {
  const columns = 1 + (details ? 2 : 0)
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
                <TableRow key={r.id}>
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
