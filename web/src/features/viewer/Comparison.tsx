import { useState, useMemo } from "react"
import { useQueries } from "@tanstack/react-query"
import { imageInfoQueryOptions } from "@/lib/image-queries"
import { Columns2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { Frame } from "@/lib/workbench"

import { ViewerToolButton } from "./controls"

import { ImageViewer } from "./ImageViewer"
export function ViewerWorkspace({
  comparisonInHeader = false,
  ids,
  rows,
  onChoose,
  onStatistics,
}: {
  comparisonInHeader?: boolean
  ids: string[]
  rows: Frame[]
  onChoose: (second?: boolean) => void
  onStatistics?: () => void
}) {
  const [view, setView] = useState("split"),
    [same, setSame] = useState(false)
  const comparison = useQueries({
    queries:
      same && ids.length > 1
        ? [...new Set(ids)].map(imageInfoQueryOptions)
        : [],
  })
  const low =
    comparison.length && comparison.every((result) => result.isSuccess)
      ? Math.min(...comparison.map((result) => result.data!.low))
      : undefined
  const high =
    low !== undefined
      ? Math.max(...comparison.map((result) => result.data!.high))
      : undefined
  const range = useMemo<[number, number] | undefined>(
    () => (low !== undefined && high !== undefined ? [low, high] : undefined),
    [low, high]
  )
  return (
    <div className="viewer-workspace">
      <div
        className="viewer-comparison"
        hidden={comparisonInHeader && ids.length < 2}
      >
        {!comparisonInHeader && (
          <ViewerToolButton label="영상 비교" onClick={() => onChoose(true)}>
            <Columns2 />
          </ViewerToolButton>
        )}
        {ids.length > 1 && (
          <>
            <ToggleGroup
              variant="outline"
              value={[view]}
              onValueChange={(v) => {
                if (v.length) setView(v[0])
              }}
            >
              <ToggleGroupItem value="a">A</ToggleGroupItem>
              <ToggleGroupItem value="b">B</ToggleGroupItem>
              <ToggleGroupItem value="split">나란히</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              value={[same ? "same" : "each"]}
              onValueChange={(v) => {
                if (v.length) setSame(v[0] === "same")
              }}
            >
              <ToggleGroupItem value="each">개별 범위</ToggleGroupItem>
              <ToggleGroupItem value="same">같은 범위</ToggleGroupItem>
            </ToggleGroup>
          </>
        )}
      </div>
      <div
        className={cn(
          "viewer-grid",
          ids.length > 1 && view === "split" && "viewer-grid-split"
        )}
      >
        {(ids.length > 1
          ? view === "a"
            ? [ids[0]]
            : view === "b"
              ? [ids[1]]
              : ids
          : [ids[0]]
        ).map((id) => (
          <ImageViewer
            key={id || "empty"}
            frame={rows.find((r) => r.id === id)}
            sharedRange={range}
            embedded={ids.length === 1}
            onStatistics={onStatistics}

            onChoose={() => onChoose(id === ids[1])}
          />
        ))}
      </div>
    </div>
  )
}
