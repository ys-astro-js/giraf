import { OutputPortEditor } from "./output-port-editor"
import {
  inputPorts,
  outputPorts,
  parsePort,
  matchesGroup,
  groupEqual,
  groupLabel,
  portFrames,
} from "@/lib/calibration-ports"
import {
  CalibrationControls,
  CalibrationPortLabel,
} from "./calibration-controls"
import { ccdTasks, correctionFlags } from "@/lib/calibration"
import { taskDisplayName } from "@/lib/workbench"
import { ParameterHelp } from "./workbench-controls"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  Pencil,
  Check,
  FolderOpen,
  X,
  Play,
  RotateCcw,
  ArrowUp,
  ArrowDown,
  HelpCircle,
  Trash2,
  ChevronDown,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { CountBadge } from "@/components/count-badge"
import { AlignmentInput } from "./alignment-input"
import { CursorInput } from "./cursor-input"
import { TaskResults } from "./task-results"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
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
import { Choice } from "@/components/workbench-controls"
import {
  type Catalog,
  type Spec,
  type Frame,
  type Slot,
  type OutputSlot,
  type Values,
  type Job,
  plannedOutputs,
  defaults,
  api,
} from "@/lib/workbench"
import {
  type Instance,
  type TaskMap,
  connectionRoles,
  resetInstanceParameters,
  resolvedSource,
} from "@/lib/task-map"

export function assigned(
  map: TaskMap,
  t: Instance,
  role: string
): { ids: string[]; pending: string[] } {
  const links = map.connections
    .filter((c) => c.target === t.id && c.role === role)
    .map((c) => ({ ...c, source: resolvedSource(map, c.source) }))
  return {
    ids: links.length
      ? links.flatMap((c) => (c.source.kind === "pending" ? [] : c.source.ids))
      : t.draft.inputs[role] || t.preprocess.inputs[role] || [],
    pending: links.flatMap((c) =>
      c.source.kind === "pending" ? [c.source.taskId] : []
    ),
  }
}
export { ParamControl, ParameterTable } from "./parameter-fields"
import { ParameterTable } from "./parameter-fields"
import { ParameterEditorFields } from "./parameter-editor"
import {
  primaryParameterNames,
  primaryInputNames,
  parameterChanged,
  type ParameterGroup,
} from "@/lib/parameter-presentation"
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"

type Props = {
  catalog: Catalog
  map: TaskMap
  task: Instance
  rows: Frame[]
  edit: (fn: (t: Instance) => Instance) => void
  pick: (slot: Slot, ids: string[], apply: (ids: string[]) => void) => void
  onOpen: (r: Frame, role?: string) => void
  onRun: () => void
  busy: boolean
  error: string
  onErrorFocus: () => void
  job?: Job
  saveDefaults: () => void
  onRemove: () => void
  reorderInput: (role: string, ids: string[]) => void
  onInputSource?: (
    role: string,
    source:
      import("@/lib/task-map").Source | { kind: "expression"; value: string }
  ) => void
  checking?: boolean
  inputRequest?: { role: string; sequence: number }
  activeTab?: string
  onTabChange?: (value: string) => void
}
export function TaskInspector({
  catalog,
  map,
  task,
  rows,
  edit,
  pick,
  onOpen,
  onRun,
  busy,
  job,
  saveDefaults,
  onRemove,
  reorderInput,
  onInputSource,
  checking,
  inputRequest,
  activeTab,
  onTabChange,
}: Props) {
  const spec: Spec = catalog.tasks.find((s) => s.name === task.task) || {
      name: task.task,
      title: task.task,
      package: task.task.split(".").slice(0, -1).join("."),
      adapter: "generic",
      runnable: false,
      reason:
        "설치된 작업 정의를 찾지 못했습니다. 패키지를 확인하고 작업 목록을 새로고침해 주세요.",
      parameters: [],
      inputs: [],
      output: null,
      kind: "text",
    },
    d = task.draft
  const [identityDraft, setIdentityDraft] = useState<{
    label: string
    description: string
  } | null>(null)
  const identityButton = useRef<HTMLButtonElement>(null)
  function closeIdentity(save: boolean) {
    if (save && identityDraft)
      edit((t) => ({
        ...t,
        label: identityDraft.label.trim() || t.task,
        description: identityDraft.description,
      }))
    setIdentityDraft(null)
    requestAnimationFrame(() => identityButton.current?.focus())
  }
  const [localTab, setLocalTab] = useState("settings")
  const [editorOpen, setEditorOpen] = useState(false)
  const [changedOnly, setChangedOnly] = useState(false)
  const [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState<Record<string, number>>({}),
    [resetValues, setResetValues] = useState<{
      parameters: Values
      parameterSets?: Record<string, Values>
    } | null>(null)
  const inspectorRef = useRef<HTMLElement>(null)
  const openRequestedInput = useEffectEvent((role: string) => {
    setEditorOpen(false)
    setExpanded((previous) => ({ ...previous, [role]: 5 }))
  })
  useEffect(() => {
    if (!inputRequest) return
    let focusFrame = 0
    const frame = requestAnimationFrame(() => {
      openRequestedInput(inputRequest.role)
      focusFrame = requestAnimationFrame(() => {
        const root = inspectorRef.current
        const control =
          root?.querySelector<HTMLElement>(
            `#source-${CSS.escape(inputRequest.role)}`
          ) || root?.querySelector<HTMLElement>("#combine-process")
        control?.scrollIntoView({ block: "nearest" })
        control?.focus({ preventScroll: true })
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(focusFrame)
    }
  }, [inputRequest])
  const [headerPreview, setHeaderPreview] = useState<
    { label: string; key: string; before: string }[]
  >([])
  const headerInputs = assigned(
    map,
    task,
    spec.inputs[0]?.name || "input"
  ).ids.join(",")
  useEffect(() => {
    let cancelled = false
    if (spec.name !== "ccdhedit") return
    const logical = String(d.parameters.parameter || "")
    const key = String(task.mapping[logical] || logical.toUpperCase())
    setHeaderPreview([])
    Promise.all(
      headerInputs
        .split(",")
        .filter(Boolean)
        .slice(0, 4)
        .map(async (id) => {
          const h = await api<{
            cards: { key: string; value: string; hdu: number }[]
          }>("header?id=" + id)
          return {
            label: rows.find((r) => r.id === id)?.label || id,
            key,
            before:
              h.cards.find((c) => c.hdu === 0 && c.key === key)?.value ??
              "항목 없음",
          }
        })
    )
      .then((v) => {
        if (!cancelled) setHeaderPreview(v)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [headerInputs, d.parameters.parameter, task.mapping, spec.name])
  const change = (key: string, value: string) =>
    edit((t) => ({
      ...t,
      draft: {
        ...t.draft,
        parameters: { ...t.draft.parameters, [key]: value },
      },
    }))
  const changePrep = (key: string, value: string) =>
    edit((t) => ({
      ...t,
      preprocess: {
        ...t.preprocess,
        parameters: { ...t.preprocess.parameters, [key]: value },
      },
    }))
  function slot(s: Slot, compact = false, prefix = "") {
    const port = parsePort(s.name, "input"),
      role = port?.role || s.name
    const assignedIds = assigned(map, task, role).ids
    const ids = port
      ? assignedIds.filter((id) => {
          const frame = allRows.find((r) => r.id === id)
          return (
            frame &&
            (frame.asset === "image-list" || matchesGroup(frame, port.group))
          )
        })
      : assignedIds
    const limit = expanded[s.name] || 0
    const expression = port ? "" : task.expressions[role] || ""
    const links = map.connections.filter(
      (c) =>
        c.target === task.id &&
        c.role === role &&
        c.source.kind !== "files" &&
        (!port || !c.targetGroup || groupEqual(c.targetGroup, port.group))
    )
    const sources = links.map(
      (c) =>
        map.tasks.find((t) => "taskId" in c.source && t.id === c.source.taskId)
          ?.label || "저장한 결과"
    )
    const summary =
      expression ||
      (sources.length
        ? [...new Set(sources)].join(", ") + " 출력"
        : ids.length === 1
          ? rows.find((r) => r.id === ids[0])?.label || "파일 1개"
          : ids.length
            ? `파일 ${ids.length}개`
            : "입력 선택")
    const replace = (next: string[]) => {
      onInputSource?.(s.name, { kind: "files", ids: next, label: s.label })
      if (!onInputSource) reorderInput(s.name, next)
    }
    const field = (
      <Field key={s.name} className="input-slot">
        {s.valueType !== "cursor" && (
          <FieldLabel htmlFor={`${prefix}source-${s.name}`}>
            {port ? (
              <CalibrationPortLabel
                role={compact ? undefined : role}
                group={port.group}
              />
            ) : (
              s.name
            )}
            {s.required && <span aria-hidden="true">*</span>}
          </FieldLabel>
        )}
        <Button
          id={`${prefix}source-${s.name}`}
          variant="outline"
          className="w-full min-w-0 justify-between"
          aria-label={`${port ? role + " " + groupLabel(port.group) : s.name} 입력 변경`}
          aria-describedby={
            !port && !compact && s.valueType !== "cursor"
              ? `${prefix}source-${s.name}-description`
              : undefined
          }
          aria-expanded={limit > 0}
          onClick={() =>
            setExpanded((v) => ({ ...v, [s.name]: limit ? 0 : 5 }))
          }
        >
          <span className="truncate">{summary}</span>
          <ChevronDown />
        </Button>
        {!port && !compact && s.valueType !== "cursor" && (
          <ParameterHelp
            p={{ name: s.name, prompt: s.label, min: "", max: "" }}
            id={`${prefix}source-${s.name}-description`}
          />
        )}
        {limit > 0 && (
          <Tabs
            defaultValue={
              expression ? "expression" : links.length ? "node" : "files"
            }
          >
            <TabsList className="w-full">
              <TabsTrigger value="files">파일</TabsTrigger>
              {!port && <TabsTrigger value="expression">표현식</TabsTrigger>}
              <TabsTrigger value="node">노드 출력</TabsTrigger>
            </TabsList>
            <TabsContent value="files">
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  pick(s, ids, (next) => {
                    replace(next)
                    setExpanded((v) => ({ ...v, [s.name]: 0 }))
                  })
                }
              >
                <FolderOpen />
                파일 선택
              </Button>
              <ul className="input-files">
                {ids.slice(0, limit).map((id, i) => {
                  const r = rows.find((r) => r.id === id)
                  return (
                    <li key={id + ":" + i}>
                      <Button
                        variant="link"
                        size="sm"
                        className="min-w-0 flex-1 justify-start px-0"
                        onClick={() => r && onOpen(r, s.name)}
                      >
                        <span className="truncate">{r?.label || id}</span>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${i + 1}번 입력 위로 이동`}
                        disabled={i === 0}
                        onClick={() => {
                          const next = [...ids]
                          ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
                          replace(next)
                        }}
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${i + 1}번 입력 아래로 이동`}
                        disabled={i === ids.length - 1}
                        onClick={() => {
                          const next = [...ids]
                          ;[next[i + 1], next[i]] = [next[i], next[i + 1]]
                          replace(next)
                        }}
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`${r?.label || id} 입력 해제`}
                        onClick={() => replace(ids.filter((_, n) => n !== i))}
                      >
                        <X />
                      </Button>
                    </li>
                  )
                })}
                {ids.length > limit && (
                  <li>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setExpanded((v) => ({ ...v, [s.name]: limit + 50 }))
                      }
                    >
                      더 보기 <CountBadge count={ids.length - limit} />
                    </Button>
                  </li>
                )}
              </ul>
            </TabsContent>
            <TabsContent value="expression">
              <Input
                id={`${prefix}expr-${s.name}`}
                aria-label={`${s.name} 표현식`}
                placeholder="파일명 또는 표현식"
                value={expression}
                onChange={(e) =>
                  onInputSource?.(s.name, {
                    kind: "expression",
                    value: e.target.value,
                  })
                }
              />
            </TabsContent>
            <TabsContent value="node">
              <Choice
                label={`${s.name} 연결할 작업`}
                value={
                  links.length && "taskId" in links[0].source
                    ? links[0].source.taskId || ""
                    : ""
                }
                options={map.tasks
                  .filter((t) => t.id !== task.id)
                  .map((t) => ({ value: t.id, label: t.label }))}
                onChange={(id) => {
                  onInputSource?.(s.name, { kind: "pending", taskId: id })
                  setExpanded((v) => ({ ...v, [s.name]: 0 }))
                }}
              />
            </TabsContent>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                replace([])
                setExpanded((v) => ({ ...v, [s.name]: 0 }))
              }}
            >
              입력 비우기
            </Button>
          </Tabs>
        )}
      </Field>
    )
    if (
      spec.name === "images.immatch.imalign" &&
      (s.name === "coords" || s.name === "shifts")
    ) {
      const allRows = [...rows, ...map.runs.flatMap((run) => run.products)]
      const inputIds = assigned(map, task, "input").ids
      const referenceIds = assigned(map, task, "reference").ids
      const frames = inputIds.map((id) => allRows.find((row) => row.id === id))
      return (
        <AlignmentInput
          key={JSON.stringify([task.id, s.name, referenceIds, inputIds])}
          name={s.name}
          reference={allRows.find((row) => row.id === referenceIds[0])}
          frames={
            frames.every((f) => f && f.asset !== "text")
              ? (frames as Frame[])
              : []
          }
          coords={d.textInputs?.coords || ""}
          value={d.textInputs?.[s.name] || ""}
          fileInput={field}
          hasFile={!!(ids.length || links.length || expression)}
          onChange={(value) => {
            if (value.trim() && (ids.length || links.length || expression))
              replace([])
            edit((t) => ({
              ...t,
              expressions: {
                ...t.expressions,
                [s.name]: value.trim() ? "" : t.expressions[s.name] || "",
              },
              draft: {
                ...t.draft,
                textInputs: { ...t.draft.textInputs, [s.name]: value },
                alignmentBinding:
                  t.draft.alignmentBinding ||
                  (referenceIds.length &&
                  !task.expressions.reference &&
                  !task.expressions.input &&
                  frames.every((f) => f && f.asset !== "text")
                    ? { reference: referenceIds, input: inputIds }
                    : undefined),
                inputs: {
                  ...t.draft.inputs,
                  [s.name]: value.trim() ? [] : t.draft.inputs[s.name] || [],
                },
              },
            }))
          }}
        />
      )
    }
    if (s.valueType !== "cursor") return field
    const imageSlot = spec.inputs.find((input) => input.kind === "image")
    const imageId = imageSlot
      ? assigned(map, task, imageSlot.name).ids[0]
      : undefined
    const frame = [...rows, ...map.runs.flatMap((run) => run.products)].find(
      (row) => row.id === imageId
    )
    return (
      <CursorInput
        key={`${task.id}:${s.name}`}
        idPrefix={prefix}
        slot={s}
        frame={frame}
        fileInput={field}
        hasFile={!!(ids.length || links.length || expression)}
        value={d.cursorCommands?.[s.name] || ""}
        onChange={(value) => {
          if (value.trim() && (ids.length || links.length || expression))
            replace([])
          edit((t) => ({
            ...t,
            expressions: {
              ...t.expressions,
              [s.name]: value.trim() ? "" : t.expressions[s.name] || "",
            },
            draft: {
              ...t.draft,
              cursorCommands: { ...t.draft.cursorCommands, [s.name]: value },
              inputs: {
                ...t.draft.inputs,
                [s.name]: value.trim() ? [] : t.draft.inputs[s.name] || [],
              },
            },
          }))
        }}
      />
    )
  }
  const previewDraft = {
    ...d,
    inputs: Object.fromEntries(
      connectionRoles(spec, catalog).map((s) => [
        s.name,
        assigned(map, task, s.name).ids,
      ])
    ),
  }
  const specialized = ccdTasks.has(spec.name)
  const allRows = [...rows, ...map.runs.flatMap((r) => r.products)]
  const selectedFrames = (role: string) =>
    assigned(map, task, role)
      .ids.map((id) => allRows.find((r) => r.id === id))
      .filter((r): r is Frame => !!r && r.asset !== "image-list")
  const displayPorts = inputPorts(map, task, catalog, allRows)
  const mainFrames = portFrames(
    map,
    task,
    spec.inputs[0]?.name || "input",
    catalog,
    allRows
  )
  const corrections =
    spec.name === "ccdproc" ? d.parameters : task.preprocess.parameters
  const changeCorrection = spec.name === "ccdproc" ? change : changePrep
  const correctionNames = new Set(Object.values(correctionFlags))
  const primaryNames = primaryParameterNames(spec)
  const common = spec.parameters.filter(
    (p) =>
      primaryNames.includes(p.name) &&
      !(specialized && correctionNames.has(p.name))
  )
  const outputFields: OutputSlot[] = spec.outputs?.length
    ? spec.outputs
    : spec.output
      ? [{ ...spec.output, kind: spec.kind, label: spec.output.name }]
      : []
  const primaryInputs = primaryInputNames(spec)
  const inputUsed = (s: Slot) =>
    !!(
      assigned(map, task, s.name).ids.length ||
      assigned(map, task, s.name).pending.length ||
      task.expressions[s.name] ||
      d.textInputs?.[s.name] ||
      d.cursorCommands?.[s.name]
    )
  const mainInputs = specialized
    ? displayPorts.filter(
        (s) =>
          !s.group &&
          spec.inputs.some((input) => input.name === s.role) &&
          !correctionFlags[s.role] &&
          (!(s.role in { fixfile: 1, illum: 1, fringe: 1 }) ||
            d.parameters[
              (
                {
                  fixfile: "fixpix",
                  illum: "illumcor",
                  fringe: "fringecor",
                } as Record<string, string>
              )[s.role]
            ] === "yes")
      )
    : spec.inputs.filter(
        (s) =>
          primaryInputs.includes(s.name) || inputUsed(s) || expanded[s.name]
      )
  const mappingDefaults: Record<string, string> =
    specialized && spec.adapter === "generic"
      ? {
          exptime: "EXPTIME",
          subset: "FILTER",
          imagetyp: "IMAGETYP",
          darktime: "DARKTIME",
        }
      : {}
  const mappingKeys = [
    ...new Set([...Object.keys(mappingDefaults), ...Object.keys(task.mapping)]),
  ]
  const groups: ParameterGroup[] = [
    ...(mappingKeys.length
      ? [
          {
            id: "mapping",
            label: "헤더 매핑",
            parameters: mappingKeys.map((name) => ({
              name,
              type: "s",
              default: mappingDefaults[name] || "",
              choices: [],
              prompt: "",
              min: "",
              max: "",
            })),
            values: { ...mappingDefaults, ...task.mapping },
            change: (key: string, value: string) =>
              edit((t) => ({ ...t, mapping: { ...t.mapping, [key]: value } })),
          },
        ]
      : []),
    {
      id: "task",
      label: spec.taskName || taskDisplayName(spec.name),
      parameters: spec.parameters,
      values: d.parameters,
      change,
    },
    ...(spec.preprocess
      ? [
          {
            id: "preprocess",
            label: "ccdproc",
            parameters: catalog.ccdproc.parameters,
            values: task.preprocess.parameters,
            change: changePrep,
          },
        ]
      : []),
    ...(spec.parameterSets || []).map((group) => ({
      id: `set-${group.name}`,
      label: group.name === "$package" ? spec.package : group.name,
      parameters: group.parameters,
      values: task.parameterSets?.[group.name] || defaults(group.parameters),
      change: (key: string, value: string) =>
        edit((t) => ({
          ...t,
          parameterSets: {
            ...t.parameterSets,
            [group.name]: {
              ...defaults(group.parameters),
              ...t.parameterSets?.[group.name],
              [key]: value,
            },
          },
        })),
    })),
    ...(spec.adapter !== "generic"
      ? [
          {
            id: "package",
            label: "ccdred",
            parameters: catalog.ccdred,
            values: task.packageValues,
            change: (key: string, value: string) =>
              edit((t) => ({
                ...t,
                packageValues: { ...t.packageValues, [key]: value },
              })),
          },
        ]
      : []),
  ]
  const changedParameters = groups.flatMap((g) =>
    g.parameters
      .filter((p) => parameterChanged(p, g.values))
      .map((p) => ({
        name: `${g.label}.${p.name}`,
        value: String(g.values[p.name] ?? p.default),
      }))
  )
  const searchMatch = (name: string, help = "") =>
    query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .every((term) =>
        `${spec.name}.${name} ${help}`.toLowerCase().includes(term)
      )
  const editorInputs = [
    ...spec.inputs,
    ...(spec.preprocess
      ? catalog.ccdproc.inputs.filter(
          (s) => !spec.inputs.some((input) => input.name === s.name)
        )
      : []),
  ].filter(
    (s) => searchMatch(s.name, s.label) && (!changedOnly || inputUsed(s))
  )
  const editorOutputs = outputFields.filter(
    (s) =>
      searchMatch(s.name, s.label) &&
      (!changedOnly ||
        String(
          spec.adapter === "generic"
            ? (d.outputs?.[s.name] ?? s.default)
            : d.output.name
        ) !== String(s.default))
  )
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
    <section
      ref={inspectorRef}
      className="task-inspector"
      aria-label="선택 작업"
    >
      <header className="inspector-heading">
        <div className="inspector-title">
          {identityDraft ? (
            <div
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return
                if (e.key === "Escape" || e.key === "Enter") {
                  e.preventDefault()
                  e.stopPropagation()
                  closeIdentity(e.key === "Enter")
                }
              }}
            >
              <FieldGroup className="gap-2">
                <Field>
                  <FieldLabel className="sr-only" htmlFor="node-title">
                    노드 제목
                  </FieldLabel>
                  <Input
                    autoFocus
                    id="node-title"
                    aria-label="노드 제목"
                    placeholder={taskDisplayName(task.task)}
                    value={identityDraft.label}
                    onChange={(e) =>
                      setIdentityDraft({
                        ...identityDraft,
                        label: e.target.value,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel className="sr-only" htmlFor="node-description">
                    노드 설명
                  </FieldLabel>
                  <Input
                    id="node-description"
                    aria-label="노드 설명"
                    value={identityDraft.description}
                    onChange={(e) =>
                      setIdentityDraft({
                        ...identityDraft,
                        description: e.target.value,
                      })
                    }
                  />
                </Field>
              </FieldGroup>
              <div className="identity-actions">
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="편집 취소"
                  title="편집 취소"
                  onClick={() => closeIdentity(false)}
                >
                  <X />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="변경 적용"
                  title="변경 적용"
                  onClick={() => closeIdentity(true)}
                >
                  <Check />
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="identity-heading">
                <h2
                  className="truncate"
                  title={`${spec.package}.${spec.taskName || taskDisplayName(spec.name)}`}
                >
                  {task.label === task.task
                    ? taskDisplayName(task.task)
                    : task.label || taskDisplayName(task.task)}
                </h2>
                <Button
                  ref={identityButton}
                  size="icon-sm"
                  variant="ghost"
                  aria-label="제목과 설명 편집"
                  title="제목과 설명 편집"
                  onClick={() =>
                    setIdentityDraft({
                      label: task.label,
                      description:
                        task.description ?? spec.description ?? spec.title,
                    })
                  }
                >
                  <Pencil />
                </Button>
              </div>
              <span
                className="text-muted-foreground"
                title={task.description ?? spec.description ?? spec.title}
              >
                {task.description ?? spec.description ?? spec.title}
              </span>
            </>
          )}
          {task.label !== task.task && (
            <code
              className="node-command"
              title={`${spec.package}.${spec.taskName || taskDisplayName(spec.name)}`}
            >
              {taskDisplayName(task.task)}
            </code>
          )}
        </div>
        <Button
          size="icon"
          variant="secondary"
          aria-label={checking ? "확인 중" : busy ? "실행 중" : "실행"}
          title={checking ? "확인 중" : busy ? "실행 중" : "실행"}
          disabled={busy || checking || spec.runnable === false}
          onClick={onRun}
        >
          <Play />
        </Button>
      </header>
      <div className="inspector-body scroll-fade scroll-fade-4">
        {spec.reason && (
          <Alert>
            <AlertDescription>{spec.reason}</AlertDescription>
          </Alert>
        )}
        <Tabs
          value={activeTab ?? localTab}
          onValueChange={(v) => {
            setLocalTab(String(v))
            onTabChange?.(String(v))
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="settings">설정</TabsTrigger>
            <TabsTrigger value="output">결과</TabsTrigger>
          </TabsList>
          <TabsContent value="settings" className="inspector-sections">
            <OutputPortEditor key={task.id} task={task} map={map} spec={spec} edit={edit}/>
            <Dialog
              open={editorOpen}
              onOpenChange={(open) => {
                setEditorOpen(open)
                if (!open) {
                  setQuery("")
                  setChangedOnly(false)
                }
              }}
            >
              <DialogTrigger
                render={<Button variant="outline" className="w-full" />}
              >
                전체 설정
              </DialogTrigger>
              <DialogContent
                className="parameter-editor-dialog"
                aria-describedby="parameter-editor-description"
              >
                <DialogHeader className="shrink-0 pr-8">
                  <DialogTitle>
                    {taskDisplayName(spec.name)} 전체 설정
                  </DialogTitle>
                  <DialogDescription id="parameter-editor-description">
                    변경한 값은 이 작업에 바로 반영됩니다.
                  </DialogDescription>
                </DialogHeader>
                <FieldGroup className="parameter-editor-toolbar">
                  <Field>
                    <FieldLabel htmlFor="parameter-search" className="sr-only">
                      전체 설정 검색
                    </FieldLabel>
                    <Input
                      id="parameter-search"
                      autoFocus
                      placeholder="이름 또는 설명 검색"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                  </Field>
                  <Field orientation="horizontal">
                    <FieldLabel htmlFor="parameter-changed">
                      변경한 값만
                    </FieldLabel>
                    <Switch
                      id="parameter-changed"
                      checked={changedOnly}
                      onCheckedChange={setChangedOnly}
                    />
                  </Field>
                </FieldGroup>
                <div className="parameter-editor-body">
                  <ParameterEditorFields
                    groups={groups}
                    query={query}
                    changedOnly={changedOnly}
                    hasOtherResults={
                      !!(editorInputs.length || editorOutputs.length)
                    }
                  />

                  {!!editorInputs.length && (
                    <section className="parameter-editor-section">
                      <h3>입력</h3>
                      <FieldGroup>
                        {editorInputs.map((s) => slot(s, false, "editor-"))}
                      </FieldGroup>
                    </section>
                  )}
                  {!!editorOutputs.length && (
                    <section className="parameter-editor-section">
                      <h3>출력</h3>
                      <FieldGroup>
                        {editorOutputs.map((s) => outputField(s, "editor-"))}
                      </FieldGroup>
                    </section>
                  )}
                  {spec.name === "ccdhedit" &&
                    String(d.parameters.value) === "" && (
                      <Alert>
                        <AlertDescription>
                          value를 비워 두면 해당 헤더 항목을 삭제합니다.
                        </AlertDescription>
                      </Alert>
                    )}
                  {!query.trim() && !changedOnly && (
                    <Accordion multiple>
                      {spec.adapter !== "generic" && (
                        <AccordionItem value="package">
                          <AccordionTrigger>instrument</AccordionTrigger>
                          <AccordionContent>
                            <div className="flex items-center gap-2 py-4">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() =>
                                  pick(
                                    {
                                      name: "instrument",
                                      label: "instrument",
                                      multiple: false,
                                      kind: "text",
                                    },
                                    task.instrument,
                                    (ids) =>
                                      edit((t) => ({ ...t, instrument: ids }))
                                  )
                                }
                              >
                                <FolderOpen data-icon="inline-start" />
                                instrument
                              </Button>
                              {task.instrument.length > 0 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    edit((t) => ({ ...t, instrument: [] }))
                                  }
                                >
                                  해제
                                </Button>
                              )}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                      {spec.adapter !== "generic" && (
                        <AccordionItem value="files">
                          <AccordionTrigger>파일 처리</AccordionTrigger>
                          <AccordionContent>
                            <FieldGroup>
                              <Field>
                                <FieldLabel htmlFor="file-policy">
                                  실행 대상
                                </FieldLabel>
                                <Choice
                                  id="file-policy"
                                  label="실행 대상"
                                  value={task.filePolicy.mode}
                                  options={[
                                    { value: "copy", label: "사본" },
                                    { value: "direct", label: "원본 파일" },
                                  ]}
                                  onChange={(v) =>
                                    edit((t) => ({
                                      ...t,
                                      filePolicy: {
                                        ...t.filePolicy,
                                        mode: v as "copy" | "direct",
                                      },
                                    }))
                                  }
                                />
                              </Field>
                              {task.filePolicy.mode === "direct" && (
                                <Field className="parameter-field">
                                  <FieldLabel htmlFor="backup-policy">
                                    원본 백업
                                  </FieldLabel>
                                  <Switch
                                    id="backup-policy"
                                    checked={task.filePolicy.backup}
                                    onCheckedChange={(v) =>
                                      edit((t) => ({
                                        ...t,
                                        filePolicy: {
                                          ...t.filePolicy,
                                          backup: v,
                                        },
                                      }))
                                    }
                                  />
                                </Field>
                              )}
                            </FieldGroup>
                          </AccordionContent>
                        </AccordionItem>
                      )}
                    </Accordion>
                  )}
                </div>
              </DialogContent>
            </Dialog>
            <section className="inspector-section">
              <h3>입력</h3>
              <FieldGroup>
                {mainInputs.map((s) => slot(s))}
                {spec.name === "images.immatch.imalign" &&
                  d.alignmentBinding &&
                  Object.values(d.textInputs || {}).some((v) => v.trim()) &&
                  (JSON.stringify(d.alignmentBinding.reference) !==
                    JSON.stringify(assigned(map, task, "reference").ids) ||
                    (!!d.textInputs?.shifts?.trim() &&
                      JSON.stringify(d.alignmentBinding.input) !==
                        JSON.stringify(assigned(map, task, "input").ids))) && (
                    <Alert>
                      <AlertDescription>
                        영상 선택 또는 순서가 변경되었습니다. 좌표와 이동량의 행
                        순서를 확인해 주세요.
                        <Button
                          variant="outline"
                          onClick={() =>
                            edit((t) => ({
                              ...t,
                              draft: {
                                ...t.draft,
                                alignmentBinding: {
                                  reference: assigned(map, task, "reference")
                                    .ids,
                                  input: assigned(map, task, "input").ids,
                                },
                              },
                            }))
                          }
                        >
                          현재 영상 기준으로 확인 완료
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}
              </FieldGroup>
            </section>
            {!!outputFields.length && (
              <section className="inspector-section" aria-label="출력 설정">
                <h3>출력</h3>
                <FieldGroup>
                  {outputFields
                    .filter(
                      (s) => !s.optional || (d.outputs?.[s.name] ?? s.default)
                    )
                    .map((s) => outputField(s))}
                </FieldGroup>
              </section>
            )}
            {common.length > 0 && (
              <section className="inspector-section">
                <h3>주요 설정</h3>
                <ParameterTable
                  parameters={common}
                  values={d.parameters}
                  change={change}
                  scope="main"
                />
                {spec.name === "ccdhedit" &&
                  String(d.parameters.value) === "" && (
                    <FieldDescription>
                      값을 비워 두면 해당 헤더 항목을 삭제합니다.
                    </FieldDescription>
                  )}
              </section>
            )}
            {spec.name === "flatcombine" && (
              <section className="inspector-section">
                <Field className="parameter-field">
                  <FieldLabel htmlFor="flat-subsets">subsets</FieldLabel>
                  <Switch
                    id="flat-subsets"
                    checked={d.parameters.subsets === "yes"}
                    onCheckedChange={(v) => change("subsets", v ? "yes" : "no")}
                  />
                </Field>
              </section>
            )}
            {specialized && spec.preprocess && (
              <section className="inspector-section">
                <FieldGroup>
                  <Field className="parameter-field">
                    <FieldLabel htmlFor="combine-process">process</FieldLabel>
                    <Switch
                      id="combine-process"
                      checked={d.parameters.process === "yes"}
                      onCheckedChange={(v) =>
                        change("process", v ? "yes" : "no")
                      }
                    />
                  </Field>
                </FieldGroup>
              </section>
            )}
            {specialized &&
              spec.name !== "zerocombine" &&
              (spec.name === "ccdproc" || d.parameters.process === "yes") && (
                <CalibrationControls
                  task={spec.name}
                  options={d.calibration}
                  parameters={corrections}
                  frames={mainFrames}
                  candidates={Object.fromEntries(
                    Object.keys(correctionFlags).map((role) => [
                      role,
                      selectedFrames(role),
                    ])
                  )}
                  repair={(role) => {
                    setExpanded((v) => ({ ...v, [role]: 5 }))
                    requestAnimationFrame(() =>
                      document.getElementById(`source-${role}`)?.focus()
                    )
                  }}
                  pending={Object.fromEntries(
                    Object.keys(correctionFlags).map((role) => [
                      role,
                      !!assigned(map, task, role).pending.length ||
                        !!task.expressions[role],
                    ])
                  )}
                  customMapping={
                    !!(
                      (task.mapping.exptime &&
                        task.mapping.exptime !== "EXPTIME") ||
                      (task.mapping.subset && task.mapping.subset !== "FILTER")
                    )
                  }
                  change={(value) =>
                    edit((t) => ({
                      ...t,
                      draft: { ...t.draft, calibration: value },
                    }))
                  }
                  changeParameter={changeCorrection}
                  slot={(role) => (
                    <FieldGroup>
                      {displayPorts
                        .filter((s) => s.role === role && !s.group)
                        .map((input) => slot(input, true))}
                    </FieldGroup>
                  )}
                  masters={Object.fromEntries(
                    Object.keys(correctionFlags).map((role) => [
                      role,
                      map.tasks.filter(
                        (t) =>
                          t.id !== task.id &&
                          t.task ===
                            {
                              zero: "zerocombine",
                              dark: "darkcombine",
                              flat: "flatcombine",
                            }[role]
                      ),
                    ])
                  )}
                  connectMaster={(role, id) => {
                    const parent = map.tasks.find((t) => t.id === id)!
                    const outputs = outputPorts(map, parent, catalog, allRows)
                    const ports = displayPorts.filter(
                      (p) => p.role === role && !p.group
                    )
                    for (const input of ports) {
                      const output = outputs.find((p) =>
                        groupEqual(p.group, input.group)
                      )
                      onInputSource?.(input.name, {
                        kind: "pending",
                        taskId: id,
                        ...(input.group
                          ? {
                              group: input.group,
                              port: output?.handleId,
                              outputRole: output?.outputRole,
                            }
                          : {}),
                      })
                    }
                  }}
                />
              )}
            {spec.name === "ccdhedit" && headerPreview.length > 0 && (
              <section className="inspector-section">
                <h3>변경 미리보기</h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>파일 / 키</TableHead>
                      <TableHead>현재</TableHead>
                      <TableHead>변경 후</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {headerPreview.map((p, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          {p.label}
                          <br />
                          {p.key}
                        </TableCell>
                        <TableCell>{p.before}</TableCell>
                        <TableCell>
                          {String(d.parameters.value) === ""
                            ? "삭제"
                            : String(d.parameters.value)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            )}
            {["imheader", "imstatistics"].includes(spec.name) && (
              <Field>
                <FieldLabel htmlFor="image-section">영상 영역</FieldLabel>
                <Input
                  id="image-section"
                  placeholder="[x1:x2,y1:y2]"
                  value={d.section}
                  onChange={(e) =>
                    edit((t) => ({
                      ...t,
                      draft: { ...t.draft, section: e.target.value },
                    }))
                  }
                />
              </Field>
            )}
            {!!changedParameters.length && (
              <details className="parameter-changes">
                <summary>변경한 파라미터 {changedParameters.length}개</summary>
                <dl>
                  {changedParameters.map((p) => (
                    <div key={p.name}>
                      <dt>{p.name}</dt>
                      <dd>{p.value || "빈 값"}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            )}
            <div className="inspector-secondary">
              <Button variant="outline" size="sm" onClick={saveDefaults}>
                기본 설정으로 저장
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setResetValues(
                    structuredClone({
                      parameters: d.parameters,
                      parameterSets: task.parameterSets,
                    })
                  )
                  edit((t) => resetInstanceParameters(t, spec))
                }}
              >
                <RotateCcw data-icon="inline-start" />
                설정 초기화
              </Button>
              {resetValues && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    edit((t) => ({
                      ...t,
                      draft: { ...t.draft, parameters: resetValues.parameters },
                      parameterSets: resetValues.parameterSets,
                    }))
                    setResetValues(null)
                  }}
                >
                  초기화 취소
                </Button>
              )}
            </div>
          </TabsContent>
          <TabsContent value="output" className="inspector-sections">
            <TaskResults
              key={
                task.id +
                ":" +
                (map.runs.filter((r) => r.instanceId === task.id).at(-1)?.id ||
                  "")
              }
              map={map}
              task={task}
              job={job}
            />
            {plannedOutputs(spec, previewDraft, allRows, task.mapping).length >
              0 && (
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
        </Tabs>
        <footer className="inspector-footer">
          <Button variant="outline" size="sm" onClick={onRemove}>
            <Trash2 data-icon="inline-start" />
            작업 삭제
          </Button>
          {!spec.executor && (
            <a
              href={`https://iraf.readthedocs.io/en/latest/tasks/${spec.package.replaceAll(".", "/")}/${spec.taskName || spec.name}.html`}
              target="_blank"
              rel="noreferrer"
            >
              <HelpCircle aria-hidden="true" />
              IRAF 도움말
            </a>
          )}
        </footer>
      </div>
    </section>
  )
}
