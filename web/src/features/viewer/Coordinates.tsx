import type { ImageInfo, Pixel } from "@/lib/image-queries"
import { MousePointer2 } from "lucide-react"
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { displayNumber } from "@/lib/viewer-navigation"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type * as React from "react"

export function ViewerCoordinates({
  coordinatesOpen,
  setCoordinatesOpen,
  info,
  cross,
  selectionMode,
  pixel,
  coordinates,
  submitCoordinates,
  coordinateError,
  uid,
  changeCoordinate,
  onPick,
}: {
  coordinatesOpen: boolean
  setCoordinatesOpen: React.Dispatch<React.SetStateAction<boolean>>
  info: ImageInfo | undefined
  cross: { x: number; y: number } | null
  selectionMode: boolean
  pixel: Pixel | undefined
  coordinates: [string, string]
  submitCoordinates: () => void
  coordinateError: string
  uid: string
  changeCoordinate: (index: number, value: string) => void
  onPick: ((x: number, y: number) => void) | undefined
}) {
  return (
    <div className="viewer-coordinate-overlay">
      <Popover open={coordinatesOpen} onOpenChange={setCoordinatesOpen}>
        <ButtonGroup className="viewer-pixel" aria-label="픽셀 좌표">
          <PopoverTrigger
            render={<Button variant="outline" size="icon-sm" />}
            aria-label="좌표 입력"
            title="좌표 입력"
            disabled={!info}
          >
            <MousePointer2 />
          </PopoverTrigger>
          {cross && !selectionMode && (
            <ButtonGroupText
              render={<output aria-live="polite" />}
              className="flex-wrap tabular-nums"
            >
              <span>X {cross.x}</span>
              <span>Y {cross.y}</span>
              {pixel && <span>{displayNumber(pixel.value)} ADU</span>}
            </ButtonGroupText>
          )}
        </ButtonGroup>
        <PopoverContent
          side="top"
          align="start"
          className="max-w-[calc(100vw-2rem)]"
        >
          <PopoverHeader>
            <PopoverTitle>픽셀 좌표</PopoverTitle>
          </PopoverHeader>
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              submitCoordinates()
            }}
          >
            <FieldGroup className="grid grid-cols-2 gap-3">
              {(["X", "Y"] as const).map((axis, i) => (
                <Field key={axis} data-invalid={!!coordinateError}>
                  <FieldLabel htmlFor={`${uid}-${axis}`}>{axis}</FieldLabel>
                  <Input
                    id={`${uid}-${axis}`}
                    aria-label={`픽셀 ${axis}`}
                    aria-invalid={!!coordinateError}
                    aria-describedby={
                      coordinateError ? `${uid}-coordinate-error` : undefined
                    }
                    inputMode={selectionMode ? "decimal" : "numeric"}
                    value={coordinates[i]}
                    disabled={!info}
                    onChange={(event) => changeCoordinate(i, event.target.value)}
                  />
                </Field>
              ))}
            </FieldGroup>
            {coordinateError && (
              <p
                id={`${uid}-coordinate-error`}
                role="alert"
                className="text-sm text-destructive"
              >
                {coordinateError}
              </p>
            )}
            <Button
              className="self-end"
              variant="outline"
              size="sm"
              type="submit"
              disabled={!info}
            >
              {onPick ? "좌표 선택" : "픽셀 조사"}
            </Button>
          </form>
        </PopoverContent>
      </Popover>
    </div>
  )
}
