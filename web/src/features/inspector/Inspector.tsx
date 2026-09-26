import { InspectorInputSlot } from "./InputSlot"
import { assigned } from "@/lib/task-map/inputs"
import { InspectorHeading } from "./Heading"
import { InspectorSettings } from "./SettingsTab"
import { InspectorOutputs } from "./OutputsTab"
import { InspectorInputs } from "./InputsTab"
import { InspectorInfo } from "./InfoTab"
import { NodeDependencies } from "@/components/node-dependencies"
import { taskDisplayName } from "@/lib/workbench"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  X,
  Info,
  SquareArrowRightEnter,
  SquareArrowRightExit,
  SlidersVertical,
  Route,
  Search,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

import { Button } from "@/components/ui/button"
import { SidebarHeader, SidebarInput } from "@/components/ui/sidebar"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import {
  type Catalog,
  type Spec,
  type Frame,
  type Slot,
  type Job,
  defaults,
  api,
} from "@/lib/workbench"
import { type Instance, type TaskMap } from "@/lib/task-map"
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

export { ParamControl, ParameterTable } from "@/components/parameter-fields"

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
  onDuplicate: () => void
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
  onDuplicate,
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
  const [localTab, setLocalTab] = useState("info")
  const [query, setQuery] = useState("")
  const [expanded, setExpanded] = useState<Record<string, number>>({})
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
    return (
      <InspectorInputSlot
        key={s.name}
        s={s}
        compact={compact}
        prefix={prefix}
        map={map}
        task={task}
        spec={spec}
        rows={rows}
        edit={edit}
        pick={pick}
        onOpen={onOpen}
        onInputSource={onInputSource}
        reorderInput={reorderInput}
        expanded={expanded}
        setExpanded={setExpanded}
      />
    )
  }
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
  return (
    <section
      ref={inspectorRef}
      className="task-inspector"
      aria-label="선택 작업"
    >
      <InspectorHeading
        edit={edit}
        task={task}
        spec={spec}
        checking={checking}
        busy={busy}
        onRun={onRun}
      />
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
            <NodeDependencies
              map={map}
              catalog={catalog}
              task={task}
              onSelect={onSelectNode}
            />
          </TabsContent>
          <InspectorInfo
            map={map}
            task={task}
            spec={spec}
            changedParameters={changedParameters}
            headerPreview={headerPreview}
            d={d}
            onDuplicate={onDuplicate}
            onRemove={onRemove}
          />
          <InspectorInputs
            rows={rows}
            changePrep={changePrep}
            slot={slot}
            spec={spec}
            map={map}
            task={task}
            edit={edit}
            change={change}
            setExpanded={setExpanded}
            catalog={catalog}
            onInputSource={onInputSource}
          />
          <InspectorOutputs
            catalog={catalog}
            rows={rows}
            task={task}
            map={map}
            spec={spec}
            edit={edit}
            job={job}
          />
          <InspectorSettings
            groups={groups}
            query={query}
            spec={spec}
            d={d}
            pick={pick}
            task={task}
            edit={edit}
            saveDefaults={saveDefaults}
          />
        </Tabs>
      </TooltipProvider>
    </section>
  )
}
