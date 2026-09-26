import { Button } from "@/components/ui/button"
import { Trash2, X } from "lucide-react"
import { ViewerToolButton } from "@/features/viewer/controls"
import { cn } from "@/lib/utils"
import { ImageViewer, type ViewerViewport } from "@/features/viewer/ImageViewer"
import { type Pair } from "@/lib/alignment"
import { type Frame } from "@/lib/workbench"
import type * as React from "react"

export function AlignmentCoordinates({
  reference,
  viewport,
  setViewport,
  rows,
  selected,
  measure,
  onChange,
  setSelected,
  measuring,
}: {
  reference: Frame
  viewport: ViewerViewport
  setViewport: React.Dispatch<React.SetStateAction<ViewerViewport>>
  rows: { text: string; point: Pair | null }[]
  selected: number | null
  measure: (
    frame: Frame | undefined,
    x: number,
    y: number,
    apply: (point: Pair) => void
  ) => Promise<void>
  onChange: (value: string) => void
  setSelected: React.Dispatch<React.SetStateAction<number | null>>
  measuring: boolean
}) {
  return (
    <div className="alignment-coords">
      <div className="alignment-reference">
        <ImageViewer
          frame={reference}
          embedded
          selectionMode
          navigationTools={false}
          viewport={viewport}
          onViewportChange={setViewport}
          markers={rows.flatMap((row, i) =>
            row.point
              ? [
                  {
                    x: row.point[0],
                    y: row.point[1],
                    label: String(i + 1),
                  },
                ]
              : []
          )}
          selectedMarker={selected === null ? undefined : String(selected + 1)}
          onPick={(x, y) => {
            void measure(reference, x, y, ([x, y]) => {
              const next = rows.map((row) => row.text)
              if (selected === null) next.push(`${x} ${y}`)
              else next[selected] = `${x} ${y}`
              onChange(next.join("\n") + "\n")
              setSelected(null)
            })
          }}
        />
      </div>
      <aside className="alignment-coordinate-list" aria-label="선택한 기준별">
        {selected !== null && (
          <div className="flex items-center justify-between px-2 text-sm">
            <span>{selected + 1}번 위치 변경</span>
            <ViewerToolButton
              label="위치 변경 취소"
              onClick={() => setSelected(null)}
            >
              <X />
            </ViewerToolButton>
          </div>
        )}
        {rows.length ? (
          <table className="w-full text-right text-sm tabular-nums">
            <thead>
              <tr className="text-muted-foreground">
                <th className="text-left font-normal">별</th>
                <th className="font-normal">X</th>
                <th className="font-normal">Y</th>
                <th>
                  <span className="sr-only">삭제</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className={cn(selected === i && "bg-accent")}>
                  <td className="text-left">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${i + 1}번 별 위치 변경`}
                      aria-pressed={selected === i}
                      onClick={() => setSelected(selected === i ? null : i)}
                    >
                      {i + 1}
                    </Button>
                  </td>
                  {row.point ? (
                    <>
                      <td>{row.point[0]}</td>
                      <td>{row.point[1]}</td>
                    </>
                  ) : (
                    <td colSpan={2} className="text-destructive">
                      좌표 확인 필요
                    </td>
                  )}
                  <td>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      aria-label={`${i + 1}번 별 삭제`}
                      disabled={measuring}
                      title="별 삭제"
                      onClick={() => {
                        onChange(
                          rows
                            .filter((_, j) => j !== i)
                            .map((row) => row.text)
                            .join("\n")
                        )
                        setSelected(
                          selected === i
                            ? null
                            : selected !== null && selected > i
                              ? selected - 1
                              : selected
                        )
                      }}
                    >
                      <Trash2 />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted-foreground">0개</p>
        )}
      </aside>
    </div>
  )
}
