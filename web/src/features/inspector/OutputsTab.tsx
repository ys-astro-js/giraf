import { connectionRoles } from "@/lib/task-map"
import { assigned } from "@/lib/task-map/inputs"
import type { Catalog } from "@/lib/workbench"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Choice, ParameterHelp } from "@/components/workbench-controls"
import { Button } from "@/components/ui/button"
import { ChevronDown } from "lucide-react"
import { useWorkbench } from "@/features/workbench/context"
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
  // Pass-through outputs carry their input files and have no name to edit.
  const outputFields: OutputSlot[] = spec.outputs?.length
    ? spec.outputs.filter((slot) => slot.mode !== "pass")
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
          <FieldDescription>
            {"{name}"} 자리에 입력 파일명이 들어갑니다. 뒤에 확장자를 쓰면
            그대로 쓰고, {"{name}"}이 없으면 접두사로 붙습니다.
          </FieldDescription>
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
      {spec.run === "save-files" ? (
        <DestinationFields task={task} edit={edit} />
      ) : (
        <OutputPortEditor
          key={task.id}
          task={task}
          map={map}
          spec={spec}
          rows={rows}
          edit={edit}
        />
      )}
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

/**
 * Where a file sink saves: chosen with the folder picker, never typed. A folder
 * inside the project is kept relative so the workflow travels with it.
 */
function DestinationFields({
  task,
  edit,
}: {
  task: Instance
  edit: (fn: (task: Instance) => Instance) => void
}) {
  const w = useWorkbench()
  const destination = task.draft.destination || { path: "", conflict: "number" }
  const project = w.workspace.folder.replace(/\/+$/, "")
  const folder = !destination.path
    ? project
    : destination.path.startsWith("/")
      ? destination.path
      : `${project}/${destination.path}`
  const inside = folder === project || folder.startsWith(project + "/")
  const summary = inside
    ? [
        "프로젝트 폴더",
        ...folder.slice(project.length).split("/").filter(Boolean),
      ].join(" / ")
    : folder
  const change = (next: Partial<typeof destination>) =>
    edit((t) => ({
      ...t,
      draft: {
        ...t.draft,
        destination: { ...destination, ...t.draft.destination, ...next },
      },
    }))
  return (
    <section className="inspector-section" aria-label="저장 설정">
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor={`${task.id}-destination`}>저장 위치</FieldLabel>
          <Button
            id={`${task.id}-destination`}
            variant="outline"
            className="w-full min-w-0 justify-between"
            aria-label="저장 위치 변경"
            title={folder}
            onClick={() =>
              w.setPicker({
                slot: {
                  name: "destination",
                  label: "저장 위치",
                  multiple: false,
                  kind: "any",
                },
                initial: [],
                apply: () => {},
                folderOnly: true,
                startPath: folder,
                folderAction: "이 폴더에 저장",
                applyFolder: (path) => {
                  const chosen = path.replace(/\/+$/, "")
                  change({
                    path:
                      chosen === project
                        ? ""
                        : chosen.startsWith(project + "/")
                          ? chosen.slice(project.length + 1)
                          : chosen,
                  })
                },
              })
            }
          >
            <span className="truncate">{summary}</span>
            <ChevronDown />
          </Button>
        </Field>
        <Field>
          <FieldLabel htmlFor={`${task.id}-conflict`}>
            같은 이름이 있으면
          </FieldLabel>
          <Choice
            id={`${task.id}-conflict`}
            label="같은 이름이 있으면"
            value={destination.conflict}
            options={[
              { value: "number", label: "번호 붙여 저장" },
              { value: "overwrite", label: "덮어쓰기" },
            ]}
            onChange={(value) =>
              change({ conflict: value as typeof destination.conflict })
            }
          />
        </Field>
      </FieldGroup>
    </section>
  )
}
