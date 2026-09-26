import { useImageViewport } from "./useViewport"
import { ViewerCoordinates } from "./Coordinates"
import { ViewerPixelProfile } from "./PixelProfile"
import { ViewerStatistics } from "./Statistics"
import { ViewerDisplaySettings } from "./DisplaySettings"
import { useId } from "react"
import {
  Plus,
  Minus,
  Scan,
  Columns2,
  TableProperties,
  RotateCw,
} from "lucide-react"
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group"
import { Button } from "@/components/ui/button"
import { stepPixel } from "@/lib/viewer-navigation"
import type { Frame } from "@/lib/workbench"
import { Blank } from "@/components/workbench-controls"

import { RevealFile, ViewerToolButton, ViewerPopover } from "./controls"

import type { ViewerViewport, ViewerMarker } from "./types"
export type { ViewerViewport, ViewerMarker } from "./types"
export function ImageViewer({
  frame,
  onPick,
  onChoose,
  sharedRange,
  embedded = false,
  onCompare,
  onStatistics,
  onReload,
  viewport,
  onViewportChange,
  markers = [],
  selectedMarker,
  selectionMode = false,
  navigationTools = true,
  imageOverlay,
  headerActions,
}: {
  frame?: Frame
  onPick?: (x: number, y: number) => void
  onChoose?: () => void
  sharedRange?: [number, number]
  embedded?: boolean
  onCompare?: () => void
  onStatistics?: () => void
  onReload?: () => void
  viewport?: ViewerViewport
  onViewportChange?: (viewport: ViewerViewport) => void
  markers?: ViewerMarker[]
  selectedMarker?: string
  selectionMode?: boolean
  navigationTools?: boolean
  imageOverlay?: React.ReactNode
  headerActions?: React.ReactNode
}) {
  const uid = useId()
  const {
    info,
    box,
    canvas,
    cross,
    inspect,
    size,
    scale,
    pan,
    setPan,
    dragRef,
    cursorGuidesRef,
    image,
    pick,
    range,
    applyRange,
    resetRange,
    stretch,
    setStretch,
    rangeError,
    changeRange,
    pixel,
    zoom,
    actualScale,
    reset,
    coordinatesOpen,
    setCoordinatesOpen,
    coordinates,
    submitCoordinates,
    coordinateError,
    changeCoordinate,
    loading,
    error,
    retryImage,
  } = useImageViewport({
    onPick,
    selectionMode,
    frame,
    viewport,
    onViewportChange,
    sharedRange,
    markers,
    selectedMarker,
  })
  return (
    <section
      aria-label={frame?.label || "영상"}
      className="image-viewer @container/viewer"
      data-embedded={embedded}
    >
      {!embedded && (
        <header className="flex min-w-0 items-center justify-between gap-2">
          <h2 className="min-w-0 truncate" title={frame?.label}>
            {onChoose ? (
              <Button
                variant="ghost"
                className="viewer-filename"
                onClick={onChoose}
                title="영상 변경"
              >
                <span>{frame?.label || "영상 선택"}</span>
              </Button>
            ) : (
              frame?.label || "영상"
            )}
          </h2>
          <ButtonGroup aria-label="파일 동작">
            {onReload && (
              <ViewerToolButton label="영상 다시 불러오기" onClick={onReload}>
                <RotateCw />
              </ViewerToolButton>
            )}
            {info && (
              <ViewerPopover label="FITS 헤더" icon={TableProperties}>
                <pre className="max-h-80 overflow-auto text-xs">
                  {info.header}
                </pre>
              </ViewerPopover>
            )}
            {onCompare && (
              <ViewerToolButton label="영상 비교" onClick={onCompare}>
                <Columns2 />
              </ViewerToolButton>
            )}
            {frame && <RevealFile id={frame.id} />}
            {headerActions}
          </ButtonGroup>
        </header>
      )}
      <div ref={box} className="viewer-image bg-muted">
        {!frame ? (
          <Blank>영상 선택</Blank>
        ) : (
          <canvas
            ref={canvas}
            tabIndex={0}
            aria-label={onPick ? "별 위치 선택" : "영상 픽셀 조사"}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Enter"
            title="방향키로 픽셀 이동. Shift와 함께 누르면 10픽셀 이동. Enter로 선택."
            className="size-full cursor-crosshair touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
            onKeyDown={(e) => {
              if (!info) return
              if (
                ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(
                  e.key
                )
              ) {
                e.preventDefault()
                const p = stepPixel(cross, e.key, info, e.shiftKey ? 10 : 1)
                inspect(p.x, p.y)
                const fit = Math.min(
                    size.width / info.width,
                    size.height / info.height
                  ),
                  w = info.width * fit * scale,
                  h = info.height * fit * scale
                const px =
                    (size.width - w) / 2 +
                    pan.x +
                    ((p.x - 0.5) / info.width) * w,
                  py =
                    (size.height - h) / 2 +
                    pan.y +
                    ((info.height - p.y + 0.5) / info.height) * h
                setPan((old) => ({
                  x:
                    old.x +
                    (px < 16
                      ? 16 - px
                      : px > size.width - 16
                        ? size.width - 16 - px
                        : 0),
                  y:
                    old.y +
                    (py < 16
                      ? 16 - py
                      : py > size.height - 16
                        ? size.height - 16 - py
                        : 0),
                }))
              } else if (e.key === "Enter" && cross && onPick) {
                e.preventDefault()
                onPick(cross.x, cross.y)
              }
            }}
            onPointerDown={(e) => {
              e.currentTarget.focus()
              dragRef.current = {
                x: e.clientX,
                y: e.clientY,
                startX: pan.x,
                startY: pan.y,
              }
              e.currentTarget.setPointerCapture(e.pointerId)
            }}
            onPointerMove={(e) => {
              const guides = cursorGuidesRef.current
              if (guides && image && e.pointerType !== "touch") {
                const rect = e.currentTarget.getBoundingClientRect()
                const x = e.clientX - rect.left,
                  y = e.clientY - rect.top
                guides.hidden =
                  x < 0 || y < 0 || x > rect.width || y > rect.height
                guides.style.setProperty("--cursor-x", `${x}px`)
                guides.style.setProperty("--cursor-y", `${y}px`)
              }
              if (dragRef.current)
                setPan({
                  x: dragRef.current.startX + e.clientX - dragRef.current.x,
                  y: dragRef.current.startY + e.clientY - dragRef.current.y,
                })
            }}
            onPointerUp={(e) => {
              if (
                dragRef.current &&
                Math.hypot(
                  e.clientX - dragRef.current.x,
                  e.clientY - dragRef.current.y
                ) < 4
              )
                pick(e.clientX, e.clientY)
              dragRef.current = null
              e.currentTarget.releasePointerCapture(e.pointerId)
            }}
            onPointerLeave={() => {
              if (cursorGuidesRef.current) cursorGuidesRef.current.hidden = true
            }}
            onPointerCancel={() => {
              dragRef.current = null
              if (cursorGuidesRef.current) cursorGuidesRef.current.hidden = true
            }}
          />
        )}

        {selectionMode && (
          <div
            ref={cursorGuidesRef}
            className="viewer-cursor-guides"
            hidden
            aria-hidden="true"
          >
            <span />
            <span />
          </div>
        )}
        {imageOverlay}
        <ButtonGroup className="viewer-panel-switch" aria-label="영상 분석">
          <ViewerDisplaySettings
            info={info}
            sharedRange={sharedRange}
            range={range}
            applyRange={applyRange}
            resetRange={resetRange}
            uid={uid}
            stretch={stretch}
            setStretch={setStretch}
            rangeError={rangeError}
            changeRange={changeRange}
          />
          {!selectionMode && (
            <ViewerStatistics info={info} onStatistics={onStatistics} />
          )}
          {!onPick && <ViewerPixelProfile info={info} pixel={pixel} />}
        </ButtonGroup>
        {navigationTools && (
          <div className="viewer-zoom">
            <ButtonGroup aria-label="확대 및 축소">
              <ViewerToolButton
                variant="outline"
                label="축소"
                disabled={!image}
                onClick={() => zoom(1 / 1.25)}
              >
                <Minus />
              </ViewerToolButton>
              <ButtonGroupText
                render={<output aria-label="현재 배율" />}
                className="min-w-16 justify-center tabular-nums"
              >
                {info ? `${Math.round(actualScale * 1000) / 10}%` : "—"}
              </ButtonGroupText>
              <ViewerToolButton
                variant="outline"
                label="확대"
                disabled={!image}
                onClick={() => zoom(1.25)}
              >
                <Plus />
              </ViewerToolButton>
            </ButtonGroup>
            <ButtonGroup aria-label="영상 맞춤">
              <ViewerToolButton
                variant="outline"
                label="화면에 맞춤"
                disabled={!image}
                onClick={reset}
              >
                <Scan />
              </ViewerToolButton>
            </ButtonGroup>
          </div>
        )}
        <ViewerCoordinates
          coordinatesOpen={coordinatesOpen}
          setCoordinatesOpen={setCoordinatesOpen}
          info={info}
          cross={cross}
          selectionMode={selectionMode}
          pixel={pixel}
          coordinates={coordinates}
          submitCoordinates={submitCoordinates}
          coordinateError={coordinateError}
          uid={uid}
          changeCoordinate={changeCoordinate}
          onPick={onPick}
        />
        {loading && (
          <div className="viewer-load-state" role="status">
            영상 불러오는 중…
          </div>
        )}
        {error && (
          <div className="viewer-load-state" role="alert">
            <span>{error}</span>
            <Button
              variant="outline"
              onClick={retryImage}
            >
              다시 시도
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
