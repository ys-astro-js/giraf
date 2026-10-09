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
import { loopOutputNames, loopVariables, memberVariables, variableMeaning } from "@/lib/containers"
import { withSubject } from "@/lib/korean"
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "@/components/ui/input-group"


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
  // Inside a foreach or for, names show the first iteration's `{variable}`.
  const previewDraft = loopOutputNames(
    {
      ...d,
      inputs: Object.fromEntries(
        connectionRoles(spec, catalog).map((s) => [
          s.name,
          assigned(map, task, s.name).ids,
        ])
      ),
    },
    loopVariables(map, catalog, task, allRows)
  )
  // Pass-through outputs carry their input files and have no name to edit.
  const outputFields: OutputSlot[] = spec.outputs?.length
    ? spec.outputs.filter((slot) => slot.mode !== "pass")
    : spec.output
      ? [{ ...spec.output, kind: spec.kind, label: spec.output.name }]
      : []
  // Inside a 각각 반복 or 반복, names can take each iteration's values.
  const variables = memberVariables(map, catalog, task)
  function outputField(output: OutputSlot, prefix = "") {
    const id = `${prefix}generic-output-${output.name}`
    const value =
      spec.adapter === "generic"
        ? (d.outputs?.[output.name] ?? output.default)
        : d.output.name
    const change = (next: string) =>
      edit((t) => ({
        ...t,
        draft:
          spec.adapter === "generic"
            ? { ...t.draft, outputs: { ...t.draft.outputs, [output.name]: next } }
            : { ...t.draft, output: { name: next } },
      }))
    const props = {
      id,
      "aria-describedby": `${id}-help`,
      placeholder: output.optional ? "비워 두면 생성하지 않습니다" : undefined,
      value,
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => change(e.target.value),
    }
    // The mark goes where the cursor is, or before the extension.
    function insertVariable(variable: string) {
      const input = document.getElementById(id) as HTMLInputElement | null
      const mark = `{${variable}}`
      const dot = value.lastIndexOf(".")
      const at = input && document.activeElement === input ? (input.selectionStart ?? value.length) : dot > 0 ? dot : value.length
      change(value.slice(0, at) + mark + value.slice(at))
      requestAnimationFrame(() => {
        input?.focus()
        input?.setSelectionRange(at + mark.length, at + mark.length)
      })
    }
    return (
      <Field key={output.name} className="generic-output-field">
        <FieldLabel htmlFor={id}>{output.name}</FieldLabel>
        {variables.length ? (
          <InputGroup>
            <InputGroupInput {...props} />
            <InputGroupAddon align="inline-end">
              {variables.map((variable) => (
                <InputGroupButton
                  key={variable}
                  aria-label={`${variableMeaning(variable)} 넣기`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertVariable(variable)}
                >
                  {/* Several keywords name themselves; one says what it holds. */}
                  {variables.length > 1 ? variable : `${variableMeaning(variable)} 넣기`}
                </InputGroupButton>
              ))}
            </InputGroupAddon>
          </InputGroup>
        ) : (
          <Input {...props} />
        )}
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
        {variables.length === 1 && (
          <FieldDescription>
            {`{${variables[0]}}`} 자리에는 회차마다 {withSubject(variableMeaning(variables[0]))} 들어갑니다.
          </FieldDescription>
        )}
        {variables.length > 1 && (
          <FieldDescription>
            {variables.map((v) => `{${v}}`).join(", ")} 자리에는 회차마다 그 키워드의 값이 들어갑니다.
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
