import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { type Catalog } from "@/lib/workbench"
import type * as React from "react"

export function AddTaskDialog({
  addOpen,
  setAddOpen,
  query,
  setQuery,
  catalog,
  add,
  template,
}: {
  addOpen: boolean
  setAddOpen: React.Dispatch<React.SetStateAction<boolean>>
  query: string
  setQuery: React.Dispatch<React.SetStateAction<string>>
  catalog: Catalog | null
  add: (name: string, ids?: string[]) => void
  template: () => void
}) {
  return (
    <Dialog open={addOpen} onOpenChange={setAddOpen}>
      <DialogContent
        className="max-h-[85dvh] overflow-auto sm:max-w-2xl"
        aria-describedby={undefined}
      >
        <DialogHeader>
          <DialogTitle>작업 추가</DialogTitle>
        </DialogHeader>
        <Input
          aria-label="추가할 작업 검색"
          placeholder="작업 이름 검색"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Task / 패키지</TableHead>
              <TableHead>작업</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {catalog?.tasks
              .filter((t) =>
                [t.name, t.title, t.package]
                  .join(" ")
                  .toLowerCase()
                  .includes(query.toLowerCase())
              )
              .map((t) => (
                <TableRow key={t.name}>
                  <TableCell>
                    {t.name}
                    <p className="text-muted-foreground">{t.package}</p>
                  </TableCell>
                  <TableCell>{t.title}</TableCell>
                  <TableCell>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => add(t.name)}
                    >
                      추가
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
        <Button variant="outline" onClick={template}>
          CCD 보정 예제 추가
        </Button>
      </DialogContent>
    </Dialog>
  )
}
