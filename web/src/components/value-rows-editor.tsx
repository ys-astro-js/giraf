import { Columns3, Plus, X } from "lucide-react"
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

/**
 * The rows of a value node: `name = value` constants or header keywords. A
 * constant can hold a value per group of the split tasks it feeds (`groups`,
 * lib/splits consumerGroups); each of those tasks takes its group's value.
 */
export function ValueRowsEditor({
  spec,
  task,
  edit,
  groups = [],
}: {
  spec: Spec
  task: Instance
  edit: (fn: (t: Instance) => Instance) => void
  groups?: { id: string; name: string }[]
}) {
  const column = columns[spec.run ?? ""]
  if (!column) return null
  const rows = task.draft.valueRows ?? []
  const setRows = (next: ValueRow[]) =>
    edit((t) => ({ ...t, draft: { ...t.draft, valueRows: next } }))
  const change = (index: number, patch: Partial<ValueRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const grouped = (name: string) => task.draft.groupValues?.[name]
  const setGrouped = (name: string, values: Record<string, string> | undefined) =>
    edit((t) => {
      const groupValues = { ...t.draft.groupValues }
      if (values) groupValues[name] = values
      else delete groupValues[name]
      return { ...t, draft: { ...t.draft, groupValues } }
    })
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
              {column.value && !grouped(row.name) && (
                <Input
                  aria-label={`${row.name || index + 1 + "행"} ${column.value}`}
                  value={row.value}
                  placeholder={column.value}
                  onChange={(e) => change(index, { value: e.target.value })}
                />
              )}
              {column.value && row.name && groups.length > 1 && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${row.name} 그룹마다 다른 값`}
                  aria-pressed={!!grouped(row.name)}
                  title={grouped(row.name) ? "모든 그룹에 같은 값" : "그룹마다 다른 값"}
                  onClick={() => setGrouped(row.name, grouped(row.name) ? undefined : Object.fromEntries(groups.map((g) => [g.id, row.value])))}
                >
                  <Columns3 />
                </Button>
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
            {grouped(row.name) && (
              <ul className="input-files pass-files group-inputs" aria-label={`${row.name} 그룹마다`}>
                {groups.map((g) => (
                  <li key={g.id}>
                    <span className="partition-chip" data-filter={g.name}>{g.name}</span>
                    <Input
                      aria-label={`${row.name} ${g.name}`}
                      value={grouped(row.name)![g.id] ?? row.value}
                      onChange={(e) => setGrouped(row.name, { ...grouped(row.name), [g.id]: e.target.value })}
                    />
                  </li>
                ))}
              </ul>
            )}
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
