import type { ImageInfo } from "@/lib/image-queries"
import { ChartColumn } from "lucide-react"
import { Button } from "@/components/ui/button"
import { displayNumber } from "@/lib/viewer-navigation"
import { ViewerPopover } from "./controls"

export function ViewerStatistics({
  info,
  onStatistics,
}: {
  info: ImageInfo | undefined
  onStatistics: (() => void) | undefined
}) {
  return (
    <ViewerPopover label="영상 통계" icon={ChartColumn} disabled={!info}>
      {info && (
        <>
          <div className="flex justify-between gap-4 text-sm text-muted-foreground">
            <span>영상 크기</span>
            <span className="tabular-nums">
              {info.width} × {info.height} px
            </span>
          </div>
          <dl className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-3 gap-y-3 text-sm">
            {(
              [
                ["평균", info.mean],
                ["중앙값", info.median],
                ["표준편차", info.std],
                ["최솟값", info.min],
                ["최댓값", info.max],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="contents">
                <dt>{label}</dt>
                <dd className="col-span-2 grid grid-cols-subgrid">
                  <span className="text-right tabular-nums">
                    {displayNumber(value)}
                  </span>
                  <span className="text-muted-foreground">ADU</span>
                </dd>
              </div>
            ))}
          </dl>
          {onStatistics && (
            <Button variant="outline" size="sm" onClick={onStatistics}>
              imstatistics로 분석
            </Button>
          )}
        </>
      )}
    </ViewerPopover>
  )
}
