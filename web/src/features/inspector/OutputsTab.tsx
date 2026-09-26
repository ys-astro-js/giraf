import { connectionRoles } from "@/lib/task-map"
import { assigned } from "@/lib/task-map/inputs"
import type { Catalog } from "@/lib/workbench"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { ParameterHelp } from "@/components/workbench-controls"
import { OutputPortEditor } from "@/components/output-port-editor"
import { TaskResults } from "@/components/task-results"
import { FieldGroup } from "@/components/ui/field"
import { TabsContent } from "@/components/ui/tabs"
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
} from "@/components/ui/table"
import {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion"
import {
  type Spec,
  type Frame,
  type OutputSlot,
  type Job,
  plannedOutputs,
} from "@/lib/workbench"
import { type Instance, type TaskMap } from "@/lib/task-map"

export function InspectorOutputs({
  task,
  map,
  spec,
  catalog,
  rows,
  edit,
  job,
}: {
  task: Instance
  map: TaskMap
  spec: Spec
  catalog: Catalog
  rows: Frame[]
  edit: (fn: (task: Instance) => Instance) => void
  job: Job | undefined
}) {
  const d = task.draft
  const allRows = [...rows, ...map.runs.flatMap((run) => run.products)]
  const previewDraft = {
    ...d,
    inputs: Object.fromEntries(
      connectionRoles(spec, catalog).map((s) => [
        s.name,
        assigned(map, task, s.name).ids,
      ])
    ),
  }
  const outputFields: OutputSlot[] = spec.outputs?.length
    ? spec.outputs
    : spec.output
      ? [{ ...spec.output, kind: spec.kind, label: spec.output.name }]
      : []
  function outputField(output: OutputSlot, prefix = "") {
    const id = `${prefix}generic-output-${output.name}`
    return (
      <Field key={output.name} className="generic-output-field">
        <FieldLabel htmlFor={id}>{output.name}</FieldLabel>
        <Input
          id={id}
          aria-describedby={`${id}-help`}
          placeholder={
            output.optional ? "비워 두면 생성하지 않습니다" : undefined
          }
          value={
            spec.adapter === "generic"
              ? (d.outputs?.[output.name] ?? output.default)
              : d.output.name
          }
          onChange={(e) =>
            edit((t) => ({
              ...t,
              draft:
                spec.adapter === "generic"
                  ? {
                      ...t.draft,
                      outputs: {
                        ...t.draft.outputs,
                        [output.name]: e.target.value,
                      },
                    }
                  : { ...t.draft, output: { name: e.target.value } },
            }))
          }
        />
        <ParameterHelp
          p={{
            name: output.name,
            prompt: output.label || "",
            min: "",
            max: "",
          }}
          id={`${id}-help`}
        />
        {["each", "edit"].includes(output.mode || "") && (
          <FieldDescription>입력별 파일명 접두사</FieldDescription>
        )}
      </Field>
    )
  }
  return (
    <TabsContent value="output" className="inspector-sections">
      {!!outputFields.length && (
        <section className="inspector-section" aria-label="출력 설정">
          <FieldGroup>{outputFields.map((s) => outputField(s))}</FieldGroup>
        </section>
      )}

      <OutputPortEditor
        key={task.id}
        task={task}
        map={map}
        spec={spec}
        edit={edit}
      />
      <TaskResults
        key={
          task.id +
          ":" +
          (map.runs.filter((r) => r.instanceId === task.id).at(-1)?.id || "")
        }
        map={map}
        task={task}
        job={job}
      />
      {plannedOutputs(spec, previewDraft, allRows, task.mapping).length > 0 && (
        <Accordion>
          <AccordionItem value="planned">
            <AccordionTrigger>출력 이름 미리보기</AccordionTrigger>
            <AccordionContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>입력</TableHead>
                    <TableHead>출력</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {plannedOutputs(
                    spec,
                    previewDraft,
                    allRows,
                    task.mapping
                  ).map((p, i) => (
                    <TableRow key={i}>
                      <TableCell>{p.input}</TableCell>
                      <TableCell>{p.output}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </TabsContent>
  )
}
