import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ImageViewer } from "./image-viewer"
import { Choice } from "./workbench-controls"
import { parsePairs, pickAlignmentStar, type Pair } from "@/lib/alignment"
import type { Frame } from "@/lib/workbench"

export function AlignmentInput({
  name,
  value,
  onChange,
  fileInput,
  hasFile,
  reference,
  frames,
}: {
  name: "coords" | "shifts"
  value: string
  onChange: (value: string) => void
  fileInput: React.ReactNode
  hasFile: boolean
  reference?: Frame
  frames: Frame[]
  coords: string
}) {
  const id = useId(),
    isCoords = name === "coords"
  const [mode, setMode] = useState(hasFile ? "file" : "direct")
  const [open, setOpen] = useState(false),
    [index, setIndex] = useState("-1")
  const [anchor, setAnchor] = useState<Pair>()
  const pairs = parsePairs(value)
  const pickingReference = !isCoords && (!anchor || index === "-1")
  const invalid =
    !!value.trim() &&
    (!pairs ||
      (isCoords
        ? pairs.some((p) => p.some((v) => v < 1))
        : frames.length > 0 && pairs.length !== frames.length))
  const frame = isCoords || pickingReference ? reference : frames[Number(index)]
  return (
    <Field data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id}>{name}</FieldLabel>
      <Tabs value={mode} onValueChange={(v) => setMode(String(v))}>
        <TabsList className="w-full">
          <TabsTrigger value="direct">직접 입력</TabsTrigger>
          <TabsTrigger value="file">기존 입력</TabsTrigger>
        </TabsList>
        <TabsContent
          value="direct"
          className="flex min-w-0 flex-col gap-3 pt-2"
        >
          <Textarea
            id={id}
            aria-invalid={invalid}
            value={value}
            rows={4}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
          />
          {invalid && (
            <p role="alert" className="text-sm text-destructive">
              {isCoords
                ? "각 행에 1 이상의 X Y 두 수치를 입력해 주세요."
                : "입력 영상마다 ΔX ΔY 두 수치를 입력해 주세요. 미선택 행의 ?를 채워 주세요."}
            </p>
          )}
          <Button
            variant="outline"
            disabled={isCoords ? !reference : !reference || !frames.length}
            onClick={() => {
              setIndex("-1")
              setAnchor(undefined)
              setOpen(true)
            }}
          >
            {isCoords ? "영상에서 별 선택" : "같은 별로 이동량 계산"}
          </Button>
          {!reference && (
            <FieldDescription>
              기준 영상을 먼저 선택해 주세요.
            </FieldDescription>
          )}
          {!isCoords && frames.length > 0 && (
            <ol
              className="flex flex-col gap-1 text-sm text-muted-foreground"
              aria-label="이동량 행 순서"
            >
              {frames.map((f, i) => (
                <li key={`${i}:${f.id}`} className="truncate" title={f.label}>
                  {i + 1}. {f.label}
                </li>
              ))}
            </ol>
          )}
        </TabsContent>
        <TabsContent value="file" className="pt-2">
          {value.trim() ? (
            <Button variant="outline" onClick={() => onChange("")}>
              직접 입력을 비우고 파일 선택
            </Button>
          ) : (
            fileInput
          )}
        </TabsContent>
      </Tabs>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="alignment-picker max-h-[90dvh] gap-3 overflow-auto sm:max-w-4xl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>
              {isCoords || pickingReference
                ? "기준 영상에서 별 선택"
                : "입력 영상에서 같은 별 선택"}
            </DialogTitle>
          </DialogHeader>
          {!isCoords && !pickingReference && frames.some((f) => f.id !== reference?.id) && (
            <Choice
              label="입력 영상"
              value={index}
              options={frames.flatMap((f, i) => f.id === reference?.id ? [] : [{
                value: String(i),
                label: `${i + 1}. ${f.label}`,
              }])}
              onChange={setIndex}
            />
          )}
          <ImageViewer
            frame={frame}
            onPick={(x, y) => {
              if (isCoords)
                onChange(
                  `${value.trimEnd()}${value.trim() ? "\n" : ""}${x} ${y}\n`
                )
              else if (reference) {
                const next = pickAlignmentStar(
                  { anchor, index: Number(index), value },
                  [x, y], reference.id, frames.map((f) => f.id)
                )
                setAnchor(next.anchor)
                setIndex(String(next.index))
                onChange(next.value)
              }
            }}
          />
          <p role="status" className="text-sm whitespace-pre-wrap tabular-nums">
            {isCoords
              ? `선택한 기준별 ${pairs?.length || 0}개`
              : value.trim() || "아직 선택한 이동량이 없습니다."}
          </p>
          <div className="flex justify-end gap-2">
            {!isCoords && anchor && (
              <Button variant="outline" onClick={() => setIndex("-1")}>
                기준별 다시 선택
              </Button>
            )}
            <Button
              variant="outline"
              disabled={!value.trim()}
              onClick={() => {
                if (isCoords) onChange(value.trimEnd().split("\n").slice(0, -1).join("\n"))
                else {
                  onChange("")
                  setAnchor(undefined)
                  setIndex("-1")
                }
              }}
            >
              {isCoords ? "마지막 행 지우기" : "이동량 비우기"}
            </Button>
            <Button onClick={() => setOpen(false)}>완료</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Field>
  )
}
