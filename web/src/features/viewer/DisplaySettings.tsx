import type { ImageInfo } from "@/lib/image-queries"
import { SlidersHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { displayNumber } from "@/lib/viewer-navigation"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
  FieldSet,
  FieldLegend,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { ViewerPopover } from "./controls"
import type * as React from "react"

export function ViewerDisplaySettings({
  info,
  sharedRange,
  range,
  applyRange,
  resetRange,
  uid,
  stretch,
  setStretch,
  rangeError,
  changeRange,
}: {
  info: ImageInfo | undefined
  sharedRange: [number, number] | undefined
  range: [string, string]
  applyRange: () => void
  resetRange: () => void
  uid: string
  stretch: string
  setStretch: React.Dispatch<React.SetStateAction<string>>
  rangeError: string
  changeRange: (index: number, value: string) => void
}) {
  return (
    <ViewerPopover label="표시 설정" icon={SlidersHorizontal} disabled={!info}>
      <form
        className="flex flex-col gap-5"
        onSubmit={(event) => {
          event.preventDefault()
          applyRange()
        }}
      >
        <Field>
          <FieldLabel id={`${uid}-stretch`}>명암 변환</FieldLabel>
          <ToggleGroup
            variant="outline"
            spacing={0}
            aria-labelledby={`${uid}-stretch`}
            value={[stretch]}
            onValueChange={(values) => {
              if (values.length) setStretch(values[0])
            }}
          >
            <ToggleGroupItem value="asinh">Asinh</ToggleGroupItem>
            <ToggleGroupItem value="linear">Linear</ToggleGroupItem>
          </ToggleGroup>
        </Field>
        {info && (
          <FieldSet className="gap-3">
            <FieldLegend variant="label">
              밝기 범위 <span className="text-muted-foreground">ADU</span>
            </FieldLegend>
            <FieldGroup className="grid grid-cols-2 gap-3">
              {(["최솟값", "최댓값"] as const).map((label, i) => (
                <Field key={label} data-invalid={!!rangeError}>
                  <FieldLabel htmlFor={`${uid}-range-${i}`}>{label}</FieldLabel>
                  <Input
                    id={`${uid}-range-${i}`}
                    inputMode="decimal"
                    aria-invalid={!!rangeError}
                    aria-describedby={
                      rangeError ? `${uid}-range-error` : undefined
                    }
                    value={
                      sharedRange ? displayNumber(sharedRange[i]) : range[i]
                    }
                    disabled={!!sharedRange}
                    onChange={(event) => changeRange(i, event.target.value)}
                  />
                </Field>
              ))}
            </FieldGroup>
            {sharedRange && (
              <FieldDescription>
                두 영상에 같은 범위를 적용 중입니다.
              </FieldDescription>
            )}
            {rangeError && (
              <p
                id={`${uid}-range-error`}
                role="alert"
                className="text-sm text-destructive"
              >
                {rangeError}
              </p>
            )}
            <div className="flex justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={!!sharedRange}
                onClick={resetRange}
              >
                자동 범위
              </Button>
              <Button
                type="submit"
                variant="outline"
                size="sm"
                disabled={!!sharedRange}
              >
                적용
              </Button>
            </div>
          </FieldSet>
        )}
      </form>
    </ViewerPopover>
  )
}
