import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  Field,
  FieldLabel,
  FieldDescription,
  FieldGroup,
} from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { ImageViewer } from "./image-viewer"
import type { Frame, Slot } from "@/lib/workbench"

export function CursorInput({
  slot,
  value,
  onChange,
  frame,
  fileInput,
  hasFile,
  idPrefix = "",
}: {
  slot: Slot
  value: string
  onChange: (value: string) => void
  frame?: Frame
  fileInput: React.ReactNode
  hasFile: boolean
  idPrefix?: string
}) {
  const [mode, setMode] = useState(hasFile ? "file" : "commands")
  const [open, setOpen] = useState(false)
  const [key, setKey] = useState("\\040")
  const id = `${idPrefix}cursor-${slot.name}`
  return (
    <FieldGroup className="cursor-input">
      <Field>
        <FieldLabel htmlFor={id}>{slot.name}</FieldLabel>
        <FieldDescription id={`${id}-description`}>
          {slot.label}
        </FieldDescription>
        <Tabs value={mode} onValueChange={(v) => setMode(String(v))}>
          <TabsList className="w-full">
            <TabsTrigger value="commands">명령 입력</TabsTrigger>
            <TabsTrigger value="file">기존 입력</TabsTrigger>
          </TabsList>
          <TabsContent
            value="commands"
            className="flex min-w-0 flex-col gap-3 pt-2"
          >
            <Textarea
              id={id}
              aria-label={`${slot.name} commands`}
              aria-describedby={`${id}-description`}
              rows={4}
              value={value}
              spellCheck={false}
              onChange={(e) => onChange(e.target.value)}
            />
            {slot.cursorType === "imcur" && (
              <>
                <Field>
                  <FieldLabel htmlFor={`${id}-key`}>key</FieldLabel>
                  <Input
                    id={`${id}-key`}
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    aria-label={`${slot.name} key`}
                  />
                </Field>
                <Button
                  variant="outline"
                  disabled={!frame || !key.trim()}
                  onClick={() => setOpen(true)}
                >
                  영상에서 위치 선택
                </Button>
                {!frame && (
                  <FieldDescription>
                    먼저 영상 입력을 선택해 주세요.
                  </FieldDescription>
                )}
              </>
            )}
          </TabsContent>
          <TabsContent value="file" className="pt-2">
            {value.trim() ? (
              <Button variant="outline" onClick={() => onChange("")}>
                명령을 비우고 입력 선택
              </Button>
            ) : (
              fileInput
            )}
          </TabsContent>
        </Tabs>
      </Field>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="max-h-[90dvh] overflow-auto sm:max-w-4xl"
          aria-describedby={undefined}
        >
          <DialogHeader>
            <DialogTitle>영상에서 위치 선택</DialogTitle>
          </DialogHeader>
          <ImageViewer
            frame={frame}
            onPick={(x, y) => {
              onChange(
                `${value.trimEnd()}${value.trim() ? "\n" : ""}${x} ${y} 1 ${key}\n`
              )
              setOpen(false)
            }}
          />
        </DialogContent>
      </Dialog>
    </FieldGroup>
  )
}
