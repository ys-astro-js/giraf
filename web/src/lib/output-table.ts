/**
 * A table a task prints: its last `#` header line names the columns, and
 * each following line with as many numbers (or INDEF) is a row, as daoedit
 * writes one row per star it measures.
 */
export type OutputTable = { columns: string[]; rows: string[][] }

const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/

export function outputTable(text: string): OutputTable | undefined {
  let columns: string[] = []
  let rows: string[][] = []
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/).filter(Boolean)
    if (fields[0] === "#") {
      const names = fields.slice(1)
      // A repeated header continues the same table.
      if (names.join(" ") !== columns.join(" ")) rows = []
      columns = names
      continue
    }
    if (!columns.length || fields.length !== columns.length) continue
    if (fields.every((v) => v === "INDEF" || NUMBER.test(v))) rows.push(fields)
  }
  return columns.length ? { columns: columns.map((c) => c.toLowerCase()), rows } : undefined
}
