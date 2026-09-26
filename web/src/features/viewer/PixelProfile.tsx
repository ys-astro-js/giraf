import type { ImageInfo, Pixel } from "@/lib/image-queries"
import { ChartNoAxesCombined } from "lucide-react"
import { displayNumber } from "@/lib/viewer-navigation"
import { Profile } from "./Profile"
import { ViewerPopover } from "./controls"

export function ViewerPixelProfile({
  info,
  pixel,
}: {
  info: ImageInfo | undefined
  pixel: Pixel | undefined
}) {
  return (
    <ViewerPopover
      label="픽셀 프로파일"
      icon={ChartNoAxesCombined}
      disabled={!info}
      className="w-96"
    >
      {pixel ? (
        <div className="flex min-w-0 flex-col gap-5">
          <dl className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm tabular-nums">
            <div className="flex gap-2">
              <dt className="text-muted-foreground">X</dt>
              <dd>{pixel.x}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Y</dt>
              <dd>{pixel.y}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="sr-only">픽셀 값</dt>
              <dd>{displayNumber(pixel.value)} ADU</dd>
            </div>
          </dl>
          <Profile
            values={pixel.row}
            label="가로 단면"
            selected={pixel.x}
            axis="X"
          />
          <Profile
            values={pixel.column}
            label="세로 단면"
            selected={pixel.y}
            axis="Y"
          />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          영상을 클릭해 픽셀을 선택하면 가로와 세로 밝기 분포를 볼 수 있습니다.
        </p>
      )}
    </ViewerPopover>
  )
}
