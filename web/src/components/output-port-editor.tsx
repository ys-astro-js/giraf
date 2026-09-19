import { useState } from "react"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./ui/accordion"
import { Plus, Trash2, ChevronDown } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { Checkbox } from "./ui/checkbox"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "./ui/field"
import { Choice } from "./workbench-controls"
import {
  matchesFiles,
  editableOutputPorts,
  type CustomOutputPort,
} from "@/lib/output-ports"
import type { Instance, TaskMap } from "@/lib/task-map"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./ui/tabs"
import type { Frame, Spec } from "@/lib/workbench"

export function OutputPortEditor({
  task,
  map,
  spec,
  edit,
}: {
  task: Instance
  map: TaskMap
  spec: Spec
  edit: (fn: (task: Instance) => Instance) => void
}) {
  const ports = editableOutputPorts(task, spec)
  const [open, setOpen] = useState<string[]>([])
  const run = map.runs.filter((r) => r.instanceId === task.id).at(-1)
  const products =
    run?.state === "completed"
      ? run.products.filter((p) => p.role !== "$log")
      : []
  const change = (port: CustomOutputPort) =>
    edit((t) => ({
      ...t,
      outputPorts: (t.outputPorts || []).some((p) => p.id === port.id)
        ? t.outputPorts!.map((p) => (p.id === port.id ? port : p))
        : [...(t.outputPorts || []), port],
    }))
  return (
    <section className="inspector-section" aria-label="출력 포트 설정">
      <div className="flex items-center justify-between gap-2">
        <h3>출력 포트</h3>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const id = crypto.randomUUID()
            edit((t) => ({
              ...t,
              outputPorts: [
                ...(t.outputPorts || []),
                { id, name: "", files: ["*"] },
              ],
            }))
            setOpen([id])
          }}
        >
          <Plus data-icon="inline-start" />
          포트 추가
        </Button>
      </div>
      <Accordion value={open} onValueChange={setOpen}>
        {ports.map((port, index) => {
          const label =
            port.id === "$default"
              ? "기본 출력"
              : port.id.startsWith("$role:")
                ? port.id.slice(6)
                : `추가 포트 ${index}`
          return (
            <AccordionItem key={port.id} value={port.id}>
              <AccordionTrigger>{port.name.trim() || label}</AccordionTrigger>
              <AccordionContent>
                <FieldGroup>
                  <Field>
                    <div className="flex items-center justify-between gap-2">
                      <FieldLabel htmlFor={`port-name-${port.id}`}>
                        {label} 이름
                      </FieldLabel>
                      {!port.id.startsWith("$") && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${label} 삭제`}
                          onClick={() =>
                            edit((t) => ({
                              ...t,
                              outputPorts: t.outputPorts?.filter(
                                (p) => p.id !== port.id
                              ),
                            }))
                          }
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </div>
                    <Input
                      id={`port-name-${port.id}`}
                      value={port.name}
                      placeholder="이름 없이 화살표로 표시"
                      onChange={(e) =>
                        change({ ...port, name: e.target.value })
                      }
                    />
                  </Field>
                  <OutputFileSelector
                    port={port}
                    products={products}
                    spec={spec}
                    change={change}
                  />
                </FieldGroup>
              </AccordionContent>
            </AccordionItem>
          )
        })}
      </Accordion>
    </section>
  )
}

function OutputFileSelector({
  port,
  products,
  spec,
  change,
}: {
  port: CustomOutputPort
  products: Frame[]
  spec: Spec
  change: (port: CustomOutputPort) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const available = products.filter(
    (p) => !port.outputRole || p.role === port.outputRole
  )
  const selected = available.filter((p) => matchesFiles(p, port.files))
  const patterns = port.files.map((p) => p.trim()).filter(Boolean)
  const summary =
    patterns.length === 0
      ? "선택 없음"
      : patterns.length === 1 && patterns[0] === "*"
        ? "전체 파일"
        : patterns.some((p) => /[?*]/.test(p))
          ? patterns.join(", ")
          : patterns.length === 1
            ? patterns[0]
            : `파일 ${patterns.length}개`
  const label = port.outputRole ? `${port.outputRole}: ${summary}` : summary
  return (
    <Field>
      <FieldLabel htmlFor={`port-files-toggle-${port.id}`}>
        내보낼 파일
      </FieldLabel>
      <Button
        id={`port-files-toggle-${port.id}`}
        variant="outline"
        className="w-full min-w-0 justify-between"
        aria-expanded={expanded}
        aria-controls={`port-files-panel-${port.id}`}
        title={label}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="truncate">{label}</span>
        <ChevronDown />
      </Button>
      {expanded && (
        <div
          id={`port-files-panel-${port.id}`}
          className="flex min-w-0 flex-col gap-3"
        >
          {(spec.outputs?.length || 0) > 1 && (
            <Choice
              label="출력 종류 필터"
              value={port.outputRole || "$all"}
              options={[
                { value: "$all", label: "전체 출력 종류" },
                ...spec.outputs!.map((s) => ({ value: s.name, label: s.name })),
              ]}
              onChange={(value) =>
                change({
                  ...port,
                  outputRole: value === "$all" ? undefined : value,
                })
              }
            />
          )}
          <Tabs
            defaultValue={
              patterns.some((p) => /[?*]/.test(p)) || !products.length
                ? "expression"
                : "files"
            }
          >
            <TabsList className="w-full">
              <TabsTrigger value="files">파일</TabsTrigger>
              <TabsTrigger value="expression">표현식</TabsTrigger>
            </TabsList>
            <TabsContent value="expression">
              <Textarea
                aria-label="내보낼 파일 표현식"
                value={port.files.join("\n")}
                placeholder="예: *B.fits"
                onChange={(e) =>
                  change({ ...port, files: e.target.value.split("\n") })
                }
                onBlur={() =>
                  change({
                    ...port,
                    files: port.files.map((p) => p.trim()).filter(Boolean),
                  })
                }
              />
              <FieldDescription>
                한 줄에 파일명 또는 패턴 하나. *는 모든 문자열, ?는 한
                글자입니다.
              </FieldDescription>
            </TabsContent>
            <TabsContent value="files">
              {available.length ? (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm text-muted-foreground">
                      {selected.length}개 선택
                    </span>
                    <div className="flex gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          change({
                            ...port,
                            files: available.map((p) => p.label),
                          })
                        }
                      >
                        모두 선택
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!selected.length}
                        onClick={() => change({ ...port, files: [] })}
                      >
                        해제
                      </Button>
                    </div>
                  </div>
                  <div className="output-port-file-list">
                    {available.map((product) => (
                      <Field key={product.id} orientation="horizontal">
                        <Checkbox
                          id={`port-${port.id}-${product.id}`}
                          checked={matchesFiles(product, port.files)}
                          onCheckedChange={(checked) =>
                            change({
                              ...port,
                              files: checked
                                ? [
                                    ...new Set([
                                      ...selected.map((p) => p.label),
                                      product.label,
                                    ]),
                                  ]
                                : selected
                                    .filter((p) => p.id !== product.id)
                                    .map((p) => p.label),
                            })
                          }
                        />
                        <FieldLabel
                          className="min-w-0 break-all"
                          htmlFor={`port-${port.id}-${product.id}`}
                        >
                          {product.label}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                </>
              ) : (
                <FieldDescription>
                  {products.length
                    ? "이 출력 종류의 파일이 없습니다."
                    : "실행 결과가 없습니다. 표현식으로 내보낼 파일을 미리 지정할 수 있습니다."}
                </FieldDescription>
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </Field>
  )
}
