import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { api, type Job } from "@/lib/workbench"
import type * as React from "react"

export function TaskInteractionDialog({
  currentJob,
  setError,
}: {
  currentJob: Job
  setError: React.Dispatch<React.SetStateAction<string>>
}) {
  const [response, setResponse] = useState(
    currentJob.interaction?.initial || ""
  )
  if (!currentJob.interaction) return null
  return (
    <Dialog open>
      <DialogContent
        className="max-h-[90dvh] overflow-auto sm:max-w-3xl"
        aria-describedby={undefined}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{currentJob.name}</DialogTitle>
          <p className="text-muted-foreground">사용자 입력 대기</p>
        </DialogHeader>
        <pre className="break-all whitespace-pre-wrap">
          {currentJob.interaction.prompt}
        </pre>
        {currentJob.interaction.kind === "text" && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
            {currentJob.log?.slice(-4000)}
          </pre>
        )}
        {currentJob.interaction.kind === "cursor" && (
          <img
            src={`/api/task-graphics?id=${currentJob.id}&request=${currentJob.interaction.id}`}
            alt="IRAF의 현재 overscan 피팅 그래픽"
          />
        )}
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="iraf-response">
              {currentJob.interaction.kind === "cursor"
                ? "x y wcs key [명령]"
                : "IRAF 응답"}
            </FieldLabel>
            <>
              {currentJob.interaction.kind === "editor" ? (
                <Textarea
                  id="iraf-response"
                  aria-label="instrument 파일 내용"
                  value={response}
                  onChange={(e) => setResponse(e.target.value)}
                  className="min-h-64"
                />
              ) : (
                <Input
                  id="iraf-response"
                  value={response}
                  placeholder={
                    currentJob.interaction.kind === "cursor"
                      ? "0 0 1 : order 2"
                      : "yes"
                  }
                  onChange={(e) => setResponse(e.target.value)}
                />
              )}
            </>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() =>
              api("task-cancel", { id: currentJob.id }).catch((e) =>
                setError(e.message)
              )
            }
          >
            전체 실행 중단
          </Button>
          {currentJob.interaction.kind === "cursor" && (
            <Button
              variant="outline"
              onClick={() =>
                api("task-respond", {
                  id: currentJob.id,
                  requestId: currentJob.interaction!.id,
                  value: "0 0 1 q",
                })
                  .then(() => setResponse(""))
                  .catch((e) => setError(e.message))
              }
            >
              현재 피팅 종료{" "}
              <span className="ml-auto text-muted-foreground">q</span>
            </Button>
          )}
          <Button
            disabled={!response && currentJob.interaction.kind !== "editor"}
            onClick={() =>
              api("task-respond", {
                id: currentJob.id,
                requestId: currentJob.interaction!.id,
                value: response,
              })
                .then(() => setResponse(""))
                .catch((e) => setError(e.message))
            }
          >
            응답하고 이어하기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
