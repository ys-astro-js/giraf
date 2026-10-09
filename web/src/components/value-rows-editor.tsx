import { Plus, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import type { Instance } from "@/lib/task-map"
import type { Spec, ValueRow } from "@/lib/workbench"

/** Column labels for each value run component (node schema). */
const columns: Record<string, { name: string; value?: string }> = {
  "value-constant": { name: "이름", value: "값" },
  "value-header": { name: "키워드" },
  "value-compute": { name: "이름", value: "식" },
}

/**
 * The rows of a value node: `name = value` constants, header keywords, or
 * `name = expression` computations. A constant or header node can split its
 * values by a header keyword; a constant then holds one value per group.
 */
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
  const partition = task.draft.partition ?? ""
  const groups = spec.run === "value-constant" && partition ? task.draft.partitionValues ?? [] : []
  const setRows = (next: ValueRow[]) =>
    edit((t) => ({ ...t, draft: { ...t.draft, valueRows: next } }))
  const change = (index: number, patch: Partial<ValueRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const mono = spec.run === "value-compute" ? "font-mono" : undefined
  return (
    <section className="inspector-section" aria-label="값">
      <FieldGroup>
        {spec.run !== "value-compute" && (
          <Field>
            <FieldLabel htmlFor="value-partition">나누기 기준</FieldLabel>
            <Input
              id="value-partition"
              className="font-mono"
              value={partition}
              placeholder="FILTER"
              onChange={(e) =>
                edit((t) => ({ ...t, draft: { ...t.draft, partition: e.target.value.trim().toUpperCase() || undefined } }))
              }
            />
          </Field>
        )}
        {spec.run === "value-constant" && partition && (
          <Field>
            <FieldLabel htmlFor="value-groups">그룹</FieldLabel>
            <Input
              id="value-groups"
              className="font-mono"
              value={groups.join(" ")}
              placeholder="B V"
              onChange={(e) =>
                edit((t) => ({ ...t, draft: { ...t.draft, partitionValues: e.target.value.split(/\s+/).filter(Boolean) } }))
              }
            />
          </Field>
        )}
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
              {column.value && !groups.length && (
                <Input
                  aria-label={`${row.name || index + 1 + "행"} ${column.value}`}
                  className={mono}
                  value={row.value}
                  placeholder={column.value}
                  onChange={(e) => change(index, { value: e.target.value })}
                />
              )}
              {groups.map((group) => (
                <Input
                  key={group}
                  aria-label={`${row.name || index + 1 + "행"} ${group}`}
                  value={row.groups?.[group] ?? ""}
                  placeholder={group}
                  onChange={(e) => change(index, { groups: { ...row.groups, [group]: e.target.value } })}
                />
              ))}
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
