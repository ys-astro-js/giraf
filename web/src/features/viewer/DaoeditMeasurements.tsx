import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { daoeditColumns, type DaoeditMeasurement } from "@/lib/daoedit"

export function DaoeditMeasurements({
  measurements,
  selected,
  onSelect,
}: {
  measurements: DaoeditMeasurement[]
  selected: number | null
  onSelect: (index: number) => void
}) {
  return (
    <Table aria-label="daoedit 측정값" className="tabular-nums">
      <TableHeader>
        <TableRow>
          <TableHead scope="col">별</TableHead>
          {daoeditColumns.map((key) => (
            <TableHead scope="col" className="text-right" key={key}>
              {key}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {measurements.map((row, index) => (
          <TableRow
            key={index}
            data-state={selected === index ? "selected" : undefined}
          >
            <TableCell>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`${index + 1}번 별 선택`}
                aria-pressed={selected === index}
                onClick={() => onSelect(index)}
              >
                {index + 1}
              </Button>
            </TableCell>
            {daoeditColumns.map((key) => (
              <TableCell className="text-right" key={key}>
                {row[key]}
              </TableCell>
            ))}
          </TableRow>
        ))}
        {!measurements.length && (
          <TableRow>
            <TableCell
              colSpan={8}
              className="h-20 text-center text-muted-foreground"
            >
              영상에서 별을 선택해 주세요.
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
