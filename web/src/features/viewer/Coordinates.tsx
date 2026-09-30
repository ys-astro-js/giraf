import type { ImageInfo, Pixel } from "@/lib/image-queries"
import { MousePointer2 } from "lucide-react"
import {
  ToolbarButton,
  ToolbarCluster,
  ToolbarGroup,
  ToolbarItem,
  ToolbarText,
} from "@/components/toolbar"
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
import type { ToolbarSize } from "@/components/toolbar-context"

export function ViewerCoordinates({
  size,
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
  /** Floating over an image it is compact; in a window bar it takes the bar's size. */
  size?: ToolbarSize
}) {
  return (
    <ToolbarCluster
      edge="start"
      placement="bottom"
      size={size}
      className={size ? "viewer-coordinate-overlay" : undefined}
    >
      <Popover open={coordinatesOpen} onOpenChange={setCoordinatesOpen}>
        <ToolbarGroup label="픽셀 좌표">
          <PopoverTrigger
            render={<ToolbarButton label="좌표 입력" />}
            disabled={!info}
          >
            <MousePointer2 />
          </PopoverTrigger>
          <ToolbarItem hidden={!cross || selectionMode}>
            <ToolbarText>
              <output aria-live="polite" className="viewer-pixel-readout">
                {cross && (
                  <>
                    <span>
                      {pixel?.image
                        ? `(${displayNumber(pixel.image.x)}, ${displayNumber(pixel.image.y)})`
                        : `(${cross.x}, ${cross.y})`}
                    </span>
                    {pixel && pixel.value !== null && (
                      <span>
                        {displayNumber(pixel.value)}{" "}
                        <span className="text-muted-foreground">ADU</span>
                      </span>
                    )}
                  </>
                )}
              </output>
            </ToolbarText>
          </ToolbarItem>
        </ToolbarGroup>
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
                    onChange={(event) =>
                      changeCoordinate(i, event.target.value)
                    }
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
    </ToolbarCluster>
  )
}
