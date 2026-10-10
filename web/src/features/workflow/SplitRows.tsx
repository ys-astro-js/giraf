/**
 * A split task's groups on its node (lib/splits): a strip of group chips
 * under the header that heads per-group columns, or a small matrix for a
 * split by two parts. Rows below put one value per group under each chip.
 */
import type { CSSProperties, ReactNode } from "react"
import { TokenIcon } from "@/components/split-token"
import { columnWidth, type SplitView } from "@/lib/splits"

/** The grid the chips and every row's per-group values share, so they align. */
export function Columns({ count, lead, children }: { count: number; lead?: number; children: ReactNode }) {
  const style = {
    "--split-columns": `${lead ? `${lead}px ` : ""}repeat(${count}, ${columnWidth(count)}px)`,
  } as CSSProperties
  return <span className="split-columns" style={style}>{children}</span>
}

export function GroupStrip({ view, label }: { view: SplitView; label: string }) {
  if (view.matrix) {
    const { rows, cols, cells } = view.matrix
    const lead = Math.max(32, ...rows.map((r) => r.length * 8 + 14))
    return (
      <div className="node-section node-groups" aria-label={`${label} 나누기`}>
        <div className="node-groups-row">
          <Columns count={cols.length} lead={lead}>
            <span />
            {cols.map((c) => <span key={c} className="partition-chip" data-filter={c} title={c}>{c}</span>)}
          </Columns>
        </div>
        {rows.map((r, i) => (
          <div className="node-groups-row node-groups-cells" key={r}>
            <Columns count={cols.length} lead={lead}>
              <span className="partition-chip" data-filter={r} title={r}>{r}</span>
              {cells[i].map((n, j) => (
                <span key={j} className="split-value">{n !== undefined && <><TokenIcon icon="file" />{n}</>}</span>
              ))}
            </Columns>
          </div>
        ))}
      </div>
    )
  }
  if (!view.strip) return null
  const { heads, more } = view.strip
  return (
    <div className="node-section node-groups" aria-label={`${label} 나누기`}>
      <div className="node-groups-row">
        {more ? (
          <span className="node-groups-more">
            {heads.map((h) => <span key={h} className="partition-chip" data-filter={h} title={h}>{h}</span>)}
            <span className="split-value">… {more}</span>
          </span>
        ) : (
          <Columns count={heads.length}>
            {heads.map((h) => <span key={h} className="partition-chip" data-filter={h} title={h}>{h}</span>)}
          </Columns>
        )}
      </div>
    </div>
  )
}

/** One value per group, right-aligned under the chips; `icon` marks where the values come from. */
export function GroupValues({ values, icon }: { values: (string | number | undefined)[]; icon?: Parameters<typeof TokenIcon>[0]["icon"] }) {
  return (
    <Columns count={values.length}>
      {values.map((v, i) => (
        <span key={i} className="split-value" title={v === undefined ? undefined : String(v)}>
          {icon && v !== undefined && v !== "" && <TokenIcon icon={icon} />}
          <span className="split-value-text">{v ?? ""}</span>
        </span>
      ))}
    </Columns>
  )
}
