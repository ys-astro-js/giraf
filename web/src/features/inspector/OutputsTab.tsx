import { connectionRoles, latestRuns } from "@/lib/task-map"
import { groupDraft, splitOf, taskGroups } from "@/lib/splits"
import { assigned } from "@/lib/task-map/inputs"
import type { Catalog } from "@/lib/workbench"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Choice, ParameterHelp } from "@/components/workbench-controls"
import { Button } from "@/components/ui/button"
import { ChevronDown, File } from "lucide-react"
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
  // A split task runs once per group, each naming its outputs (lib/splits groupDraft).
  const split = splitOf(task)
  const groups = split ? (taskGroups(map, task, rows).groups ?? []) : []
  const planned =
    split && groups.length > 1
      ? groups.flatMap((g) =>
          plannedOutputs(spec, groupDraft(spec, previewDraft, split.input, g, groups.length), allRows, task.mapping).map((p) => ({ ...p, group: g.name }))
        )
      : plannedOutputs(spec, previewDraft, allRows, task.mapping).map((p) => ({ ...p, group: "" }))
  const grouped = planned.some((p) => p.group)
  // Pass-through outputs carry their input files and edited copies keep their
  // input's names: neither has a name to edit.
  const outputFields: OutputSlot[] = spec.outputs?.length
    ? spec.outputs.filter((slot) => slot.mode !== "pass")
    : spec.output && spec.output.mode !== "edit"
      ? [{ ...spec.output, kind: spec.kind, label: spec.output.name }]
      : []
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
    return (
      <Field key={output.name} className="generic-output-field">
        <FieldLabel htmlFor={id}>{output.name}</FieldLabel>
        <Input {...props} />
        <ParameterHelp
          p={{
            name: output.name,
            prompt: output.label || "",
            min: "",
            max: "",
          }}
          id={`${id}-help`}
        />
        {output.mode === "each" && (
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
        key={task.id + ":" + latestRuns(map, task.id).map((r) => r.id).join(",")}
        map={map}
        task={task}
        spec={spec}
        job={job}
        rows={rows}
      />
      {planned.length > 0 && (
        <Accordion>
          <AccordionItem value="planned">
            <AccordionTrigger>출력 이름 미리보기</AccordionTrigger>
            <AccordionContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    {grouped && <TableHead>그룹</TableHead>}
                    <TableHead>입력</TableHead>
                    <TableHead>출력</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {planned.map((p, i) => (
                    <TableRow key={i}>
                      {grouped && <TableCell>{p.group}</TableCell>}
                      <TableCell>
                        {p.input}
                        {p.count !== undefined && (
                          <>
                            {p.input && " "}
                            <File className="node-input-file" aria-hidden="true" />
                            {p.count}
                          </>
                        )}
                      </TableCell>
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
