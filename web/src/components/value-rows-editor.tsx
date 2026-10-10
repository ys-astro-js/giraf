import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup } from "@/components/ui/field"
import type { Instance } from "@/lib/task-map"
import type { Spec, ValueRow } from "@/lib/workbench"

/** Column labels for each value run component (node schema); 계산 rows have their own editor. */
const columns: Record<string, { name: string; value?: string }> = {
  "value-constant": { name: "이름", value: "값" },
  "value-header": { name: "키워드" },
}

/** The rows of a value node: `name = value` constants or header keywords. */
export function ValueRowsEditor({
  spec,
  task,
  edit,
}: {
  spec: Spec
  task: Instance
  edit: (fn: (t: Instance) => Instance) => void
}) {
  const column = columns[spec.run ?? ""]
  if (!column) return null
  const rows = task.draft.valueRows ?? []
  const setRows = (next: ValueRow[]) =>
    edit((t) => ({ ...t, draft: { ...t.draft, valueRows: next } }))
  const change = (index: number, patch: Partial<ValueRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  return (
    <section className="inspector-section" aria-label="값">
      <FieldGroup>
        {rows.map((row, index) => (
          <Field key={index} data-parameter-key={row.name || undefined}>
            <div className="slot-entry">
              <Input
                aria-label={`${index + 1}행 ${column.name}`}
                className="font-mono"
                value={row.name}
                placeholder={column.name}
                onChange={(e) => change(index, { name: e.target.value.trim() })}
              />
              {column.value && (
                <Input
                  aria-label={`${row.name || index + 1 + "행"} ${column.value}`}
                  value={row.value}
                  placeholder={column.value}
                  onChange={(e) => change(index, { value: e.target.value })}
                />
              )}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`${row.name || index + 1 + "행"} 삭제`}
                onClick={() => setRows(rows.filter((_, i) => i !== index))}
              >
                <X />
              </Button>
            </div>
          </Field>
        ))}
      </FieldGroup>
      <div>
        <Button variant="outline" size="sm" onClick={() => setRows([...rows, { name: "", value: "" }])}>
          <Plus data-icon="inline-start" />
          행 추가
        </Button>
      </div>
    </section>
  )
}
