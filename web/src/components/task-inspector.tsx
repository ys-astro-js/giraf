import { NodeDependencies } from "./node-dependencies"
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
import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from "react"
import { diagnostics, resolveDiagnosticNode } from "@/lib/diagnostics"
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
  Info,
  SquareArrowRightEnter,
  SquareArrowRightExit,
  SlidersVertical,
  Route,
  Search,
  CircleX,
} from "lucide-react"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { CountBadge } from "@/components/count-badge"
import { AlignmentInput } from "./alignment-input"
import { CursorInput } from "./cursor-input"
import { TaskResults } from "./task-results"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { SidebarHeader, SidebarInput } from "@/components/ui/sidebar"
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
    .filter((c) => c.target === t.id && c.role === role && (c.source.kind !== 'files' || c.source.ids.length>0))
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
import { ParameterEditorFields } from "./parameter-editor"
import {
  parameterChanged,
  type ParameterGroup,
} from "@/lib/parameter-presentation"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function NodeErrors({ map, nodeId }: { map: TaskMap; nodeId: string }) {
  const entries = useSyncExternalStore(
    diagnostics.subscribe,
    diagnostics.getSnapshot,
    diagnostics.getSnapshot
  )
  const errors = entries.filter(
    (entry) => entry.severity === "error" && resolveDiagnosticNode(entry, map) === nodeId
  )
  if (!errors.length) return null
  return (
    <Alert className="gap-3" aria-label="노드 오류">
      <AlertTitle className="flex items-center gap-2">
        <CircleX className="size-4 shrink-0 text-destructive" aria-hidden="true" />
        오류
      </AlertTitle>
      <AlertDescription>
        <ul className="flex flex-col gap-3">
          {errors.map((entry) => (
            <li key={entry.id} className="whitespace-pre-wrap wrap-anywhere leading-relaxed">
              {entry.message}
            </li>
          ))}
        </ul>
      </AlertDescription>
    </Alert>
  )
}

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
  onSelectNode?: (id: string) => void
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
  onSelectNode,
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
  const [localTab, setLocalTab] = useState("info")
  const [query, setQuery] = useState(""),
    [expanded, setExpanded] = useState<Record<string, number>>({}),
    [resetValues, setResetValues] = useState<{
      parameters: Values
      parameterSets?: Record<string, Values>
    } | null>(null)
  const inspectorRef = useRef<HTMLElement>(null)
  const openRequestedInput = useEffectEvent((role: string) => {
    setLocalTab("input")
    onTabChange?.("input")
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
            : "선택…")
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
                찾아보기…
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
          key={JSON.stringify([task.id, s.name, inputIds])}
          name={s.name}
          backend={task.backend}
          onUseReference={(frame) => {
            if (referenceIds.length === 1 && referenceIds[0] === frame.id) return
            if (onInputSource) onInputSource("reference", {kind:"files", ids:[frame.id], label:frame.label})
            else reorderInput("reference", [frame.id])
          }}
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
  const outputFields: OutputSlot[] = spec.outputs?.length
    ? spec.outputs
    : spec.output
      ? [{ ...spec.output, kind: spec.kind, label: spec.output.name }]
      : []
  const showCalibration =
    specialized &&
    spec.name !== "zerocombine" &&
    (spec.name === "ccdproc" || d.parameters.process === "yes")
  const mainInputs =
    specialized && spec.adapter !== "generic"
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
          (input) => !showCalibration || !correctionFlags[input.name]
        )
  const groups: ParameterGroup[] = [
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
      <TooltipProvider delay={0}>
        <Tabs
          className="inspector-tabs"
          value={activeTab ?? localTab}
          onValueChange={(v) => {
            setLocalTab(String(v))
            onTabChange?.(String(v))
          }}
        >
          <SidebarHeader className="shrink-0">
            <TabsList className="w-full" aria-label="작업 상세">
              {[
                { value: "info", label: "정보", icon: Info },
                { value: "input", label: "입력", icon: SquareArrowRightEnter },
                { value: "output", label: "출력", icon: SquareArrowRightExit },
                { value: "dependencies", label: "의존성", icon: Route },
                { value: "settings", label: "설정", icon: SlidersVertical },
              ].map(({ value, label, icon: Icon }) => (
                <Tooltip key={value}>
                  <TooltipTrigger render={<TabsTrigger value={value} />}>
                    <Icon />
                    <span className="sr-only">{label}</span>
                  </TooltipTrigger>
                  <TooltipContent>{label}</TooltipContent>
                </Tooltip>
              ))}
            </TabsList>
            {(activeTab ?? localTab) === "settings" && (
              <div className="flex h-9 min-w-0 items-center gap-2">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
                  <SidebarInput
                    id="parameter-search"
                    className="pl-9"
                    aria-label="설정 검색"
                    placeholder="이름 또는 설명 검색"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                {query && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="검색 초기화"
                    onClick={() => setQuery("")}
                  >
                    <X />
                  </Button>
                )}
              </div>
            )}
          </SidebarHeader>
          {spec.reason && (
            <Alert>
              <AlertDescription>{spec.reason}</AlertDescription>
            </Alert>
          )}
          <TabsContent value="dependencies" className="inspector-dependencies">
            <NodeDependencies map={map} catalog={catalog} task={task} onSelect={onSelectNode} />
          </TabsContent>
          <TabsContent value="info" className="inspector-info">
            <div className="inspector-sections inspector-info-body">
              <NodeErrors map={map} nodeId={task.id} />
              <section className="inspector-section">
                <h3>실행 명령어</h3>
                <code className="inspector-command">
                  {spec.package
                    ? `${spec.package}.${spec.taskName || taskDisplayName(spec.name)}`
                    : spec.name}
                </code>
              </section>
              <section className="inspector-section parameter-changes">
                <h3>변경한 파라미터</h3>
                {changedParameters.length ? (
                  <dl>
                    {changedParameters.map((p) => (
                      <div key={p.name}>
                        <dt>{p.name}</dt>
                        <dd>{p.value || "빈 값"}</dd>
                      </div>
                    ))}
                  </dl>
                ) : (
                  <p className="text-muted-foreground">
                    변경한 파라미터가 없습니다.
                  </p>
                )}
              </section>
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
            </div>
            <footer className="inspector-info-actions">
              {!spec.executor && (
                <Button
                  variant="outline"
                  size="icon"
                  render={
                    <a
                      href={`https://iraf.readthedocs.io/en/latest/tasks/${spec.package.replaceAll(".", "/")}/${spec.taskName || taskDisplayName(spec.name)}.html`}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                  aria-label="IRAF 도움말"
                  title="IRAF 도움말"
                >
                  <HelpCircle />
                </Button>
              )}
              <Button
                className="ms-auto"
                variant="outline"
                size="icon"
                onClick={onRemove}
                aria-label="작업 삭제"
                title="작업 삭제"
              >
                <Trash2 />
              </Button>
            </footer>
          </TabsContent>
          <TabsContent value="input" className="inspector-sections">
            <section className="inspector-section">
              <FieldGroup>
                {mainInputs.map((s) => slot(s))}
                {!mainInputs.length && (
                  <p className="text-muted-foreground">
                    입력이 없는 작업입니다.
                  </p>
                )}
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
            {showCalibration && (
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
          </TabsContent>
          <TabsContent value="output" className="inspector-sections">
            {!!outputFields.length && (
              <section className="inspector-section" aria-label="출력 설정">
                <FieldGroup>
                  {outputFields.map((s) => outputField(s))}
                </FieldGroup>
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
          <TabsContent value="settings" className="inspector-settings">
            <div className="parameter-editor-body">
              <ParameterEditorFields
                groups={groups}
                query={query}
                changedOnly={false}
              />

              {spec.name === "ccdhedit" &&
                String(d.parameters.value) === "" && (
                  <Alert>
                    <AlertDescription>
                      value를 비워 두면 해당 헤더 항목을 삭제합니다.
                    </AlertDescription>
                  </Alert>
                )}
              {!query.trim() && (
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
                        draft: {
                          ...t.draft,
                          parameters: resetValues.parameters,
                        },
                        parameterSets: resetValues.parameterSets,
                      }))
                      setResetValues(null)
                    }}
                  >
                    초기화 취소
                  </Button>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </TooltipProvider>
    </section>
  )
}
