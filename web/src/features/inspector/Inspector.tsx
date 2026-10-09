import { InspectorInputSlot } from "./InputSlot"
import { assigned } from "@/lib/task-map/inputs"
import { InspectorHeading } from "./Heading"
import { InspectorSettings } from "./SettingsTab"
import { InspectorOutputs } from "./OutputsTab"
import { InspectorInputs } from "./InputsTab"
import { InspectorInfo } from "./InfoTab"
import { NodeDependencies } from "@/components/node-dependencies"
import { ParameterGroupNav } from "@/components/parameter-editor"
import { taskDisplayName } from "@/lib/workbench"
import { useEffect, useEffectEvent, useRef, useState } from "react"
import {
  Info,
  LocateFixed,
  SquareArrowOutUpRight,
  SquareArrowRightEnter,
  SquareArrowRightExit,
  SlidersVertical,
  Route,
} from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  isJobNode,
  isValueNode,
  psetDefinition,
  psetOutputName,
  psetSource,
  togglePinned,
  valueLinksInto,
  PARAM_HANDLE,
  VALUE_HANDLE,
} from "@/lib/values"
import { parameterLink } from "@/lib/value-take"

import { SearchField } from "@/components/search-field"
import { ValueSourceEditor } from "@/components/value-source-editor"
import { PACKAGE_SET, valueDescription } from "@/lib/value-modes"
import { isFlowSpec } from "@/lib/containers"
import { inspectorTabs, type InspectorTab } from "@/lib/inspector-tabs"
import { SidebarHeader } from "@/components/ui/sidebar"
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
  schemaParameterGroups,
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
  parameterRequest?: { key: string; sequence: number }
  /** Edits another node: a pset node this task's pset is connected to. */
  editNode?: (id: string, fn: (t: Instance) => Instance) => void
  onTakeOutPset?: (name: string) => void
  /** 다른 값에서 가져오기 for a parameter key (lib/value-take). */
  onTakeValue?: (key: string) => void
  /** Switches a 값 node's 가져오기 (lib/value-modes). */
  onValueMode?: (run: NonNullable<Spec["run"]>) => void
  /** Has a 작업 설정 node take a task's pset. */
  onPsetSource?: (taskId: string, name: string) => void
  onSelectNode?: (id: string) => void
  activeTab?: string
  onTabChange?: (value: string) => void
}
const TAB_LABELS = {
  info: { label: "정보", icon: Info },
  input: { label: "입력", icon: SquareArrowRightEnter },
  output: { label: "출력", icon: SquareArrowRightExit },
  dependencies: { label: "의존성", icon: Route },
  settings: { label: "설정", icon: SlidersVertical },
} satisfies Record<InspectorTab, { label: string; icon: typeof Info }>

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
  parameterRequest,
  editNode,
  onTakeOutPset,
  onTakeValue,
  onValueMode,
  onPsetSource,
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
  const settingsBodyRef = useRef<HTMLDivElement>(null)
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
  const openRequestedParameter = useEffectEvent(() => {
    setLocalTab("settings")
    onTabChange?.("settings")
    setQuery("")
  })
  useEffect(() => {
    if (!parameterRequest) return
    let focusFrame = 0
    const frame = requestAnimationFrame(() => {
      openRequestedParameter()
      focusFrame = requestAnimationFrame(() => {
        const field = inspectorRef.current?.querySelector<HTMLElement>(
          `[data-parameter-key="${CSS.escape(parameterRequest.key)}"]`
        )
        const control =
          field?.querySelector<HTMLElement>(
            'input, [role="switch"], [role="combobox"]'
          ) ?? field
        control?.scrollIntoView({ block: "center" })
        control?.focus({ preventScroll: true })
      })
    })
    return () => {
      cancelAnimationFrame(frame)
      cancelAnimationFrame(focusFrame)
    }
  }, [parameterRequest])
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
        catalog={catalog}
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
      keyPrefix: "",
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
    ...[
      ...(spec.parameterSets || []),
      // A pset node edits the one pset it holds.
      ...(spec.run === "pset" && task.draft.pset
        ? [{ ...psetDefinition(catalog, task.draft.pset)!, name: task.draft.pset.name }].filter((g) => g.parameters)
        : []),
    ].map((group) => {
      // A pset fed by a pset node shows and edits that node's shared values.
      const shared = psetSource(map, task.id, group.name)
      const owner = shared?.draft.pset ? shared : task
      const held = owner === task ? group.name : shared!.draft.pset!.name
      const editOwner = owner === task ? edit : (fn: (t: Instance) => Instance) => editNode?.(owner.id, fn)
      return {
        id: `set-${group.name}`,
        label: group.name === PACKAGE_SET ? spec.package : group.name,
        parameters: group.parameters,
        values: owner.parameterSets?.[held] || defaults(group.parameters),
        keyPrefix: `${group.name}.`,
        change: (key: string, value: string) =>
          editOwner((t) => ({
            ...t,
            parameterSets: {
              ...t.parameterSets,
              [held]: {
                ...defaults(group.parameters),
                ...t.parameterSets?.[held],
                [key]: value,
              },
            },
          })),
      }
    }),
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
  const displayGroups = schemaParameterGroups(spec, groups).filter(
    (group) => group.parameters.length > 0 || !(isValueNode(spec) || isFlowSpec(spec))
  )
  const hasParameters = displayGroups.some((group) => group.parameters.length > 0)
  // Only the tabs this kind of node has; a hidden tab falls back to the first.
  const tabs = inspectorTabs(spec)
  const requestedTab = activeTab ?? localTab
  const currentTab = tabs.includes(requestedTab as InspectorTab)
    ? requestedTab
    : tabs[0]
  const valueLinks = valueLinksInto(map, task.id)
  const pinning = {
    pinned: (key: string) => (task.pinned ?? []).includes(key),
    // A pset node's parameter whose value is connected onward stays pinned too.
    locked: (key: string) => {
      const offered = psetOutputName(task, key)
      return valueLinks.some((c) => c.role === PARAM_HANDLE + key) ||
        (!!offered && map.connections.some((c) => c.source.kind !== "files" && c.source.taskId === task.id &&
          c.source.outputRole === VALUE_HANDLE + offered))
    },
    // A connected parameter names its source and cannot be edited or unpinned.
    // A pset fed by a pset node takes the values connected to that node.
    linked: (key: string) => {
      const from = parameterLink(map, task.id, key)?.source
      if (!from || from.kind === "files") return undefined
      const node = map.tasks.find((t) => t.id === from.taskId)
      return `${node?.label ?? "삭제된 노드"} ${from.outputRole?.slice(VALUE_HANDLE.length) ?? ""}`
    },
    source: (key: string) => {
      const from = parameterLink(map, task.id, key)?.source
      const node = from && from.kind !== "files" ? map.tasks.find((t) => t.id === from.taskId) : undefined
      return node && { id: node.id, label: node.label }
    },
    // Task parameters and a 작업 설정 node's pset, not a 값 node's own rows.
    take: isJobNode(spec) || spec.run === "pset" ? onTakeValue : undefined,
    select: onSelectNode,
    toggle: (key: string) =>
      edit((t) => togglePinned(t, key, !(t.pinned ?? []).includes(key))),
  }
  const psetActions = (group: ParameterGroup) => {
    if (!group.id.startsWith("set-") || spec.run === "pset") return null
    const name = group.id.slice(4)
    if (name === PACKAGE_SET) return null
    const shared = psetSource(map, task.id, name)
    return shared ? (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${shared.label} 노드 선택`}
        title={`${shared.label} 노드 선택`}
        onClick={() => onSelectNode?.(shared.id)}
      >
        <LocateFixed />
      </Button>
    ) : onTakeOutPset ? (
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${name} 값 노드로 꺼내기`}
        title="값 노드로 꺼내기"
        onClick={() => onTakeOutPset(name)}
      >
        <SquareArrowOutUpRight />
      </Button>
    ) : null
  }
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
        description={valueDescription(map, catalog, task)}
        checking={checking}
        busy={busy}
        onRun={onRun}
      />
      <TooltipProvider delay={0}>
        <Tabs
          className="inspector-tabs"
          value={currentTab}
          onValueChange={(v) => {
            setLocalTab(String(v))
            onTabChange?.(String(v))
          }}
        >
          <SidebarHeader className="shrink-0">
            <TabsList variant="line" className="w-full" aria-label="작업 상세">
              {tabs.map((value) => {
                const { label, icon: Icon } = TAB_LABELS[value]
                return (
                  <Tooltip key={value}>
                    <TooltipTrigger render={<TabsTrigger value={value} />}>
                      <Icon />
                      <span className="sr-only">{label}</span>
                    </TooltipTrigger>
                    <TooltipContent>{label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </TabsList>
            {currentTab === "settings" && hasParameters && (
              <>
                <SearchField
                  id="parameter-search"
                  label="설정 검색"
                  placeholder="이름 또는 설명 검색"
                  value={query}
                  onValueChange={setQuery}
                />
                <ParameterGroupNav
                  groups={displayGroups}
                  query={query}
                  changedOnly={false}
                  bodyRef={settingsBodyRef}
                />
              </>
            )}
          </SidebarHeader>
          {spec.reason && (
            <Alert>
              <AlertDescription>{spec.reason}</AlertDescription>
            </Alert>
          )}
          {tabs.includes("dependencies") && (
            <TabsContent value="dependencies" className="inspector-dependencies">
              <NodeDependencies
                map={map}
                catalog={catalog}
                task={task}
                onSelect={onSelectNode}
              />
            </TabsContent>
          )}
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
          {tabs.includes("input") && <InspectorInputs
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
          />}
          {tabs.includes("output") && <InspectorOutputs
            catalog={catalog}
            rows={rows}
            task={task}
            map={map}
            spec={spec}
            edit={edit}
            job={job}
          />}
          {tabs.includes("settings") && <InspectorSettings
            groups={displayGroups}
            query={query}
            spec={spec}
            d={d}
            pick={pick}
            task={task}
            edit={edit}
            saveDefaults={saveDefaults}
            bodyRef={settingsBodyRef}
            map={map}
            catalog={catalog}
            rows={rows}
            pinning={pinning}
            actions={psetActions}
            valueSource={
              isValueNode(spec) && onValueMode && onPsetSource && (
                <ValueSourceEditor
                  map={map}
                  catalog={catalog}
                  spec={spec}
                  task={task}
                  onMode={onValueMode}
                  onPset={onPsetSource}
                />
              )
            }
          />}
        </Tabs>
      </TooltipProvider>
    </section>
  )
}
