import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { OutputTable } from "@/lib/output-table"

/** A task's printed table, numbered by row as its marks are on the image. */
export function OutputTableView({
  table,
  label,
}: {
  table: OutputTable
  label: string
}) {
  return (
    <Table aria-label={label} className="tabular-nums">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">번호</TableHead>
          {table.columns.map((key) => (
            <TableHead scope="col" className="text-right" key={key}>
              {key}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {table.rows.map((row, index) => (
          <TableRow key={index}>
            <TableCell>{index + 1}</TableCell>
            {row.map((value, i) => (
              <TableCell className="text-right" key={i}>
                {value}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
