import { useEffect } from "react"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Blank } from "@/components/workbench-controls"
import { TaskInspector } from "@/features/inspector/Inspector"
import { useWorkbench } from "@/features/workbench/context"
import { useLayout } from "@/features/workbench/layout-store"
import { usePanel } from "@/features/dock/context"
import { registerLockTarget } from "@/features/dock/store"
import { activeJob } from "@/lib/queries"
import { parsePort } from "@/lib/calibration-ports"
import { connectInputPort } from "@/lib/workflow-flow"
import {
  connect,
  connectionRoles,
  replaceRoleInputs,
  type Source,
} from "@/lib/task-map"

/**
 * The node window: follows the selected node, or keeps showing one node
 * while locked so it can sit beside another for comparison.
 */
export function InspectorPanel() {
  const w = useWorkbench()
  const dockWindow = usePanel()
  const locked = dockWindow?.params.locked
  const inspectorTab = useLayout((state) => state.inspectorTab)
  const setInspectorTab = useLayout((state) => state.setInspectorTab)
  const inputRequest = useLayout((state) => state.inputRequest)
  const requestInput = useLayout((state) => state.requestInput)
  const { catalog } = w
  const task = w.map.tasks.find((t) => t.id === (locked ?? w.map.view.selected))
  const taskJob = locked
    ? w.jobs.find((job) => job.manifest?.instanceId === task?.id)
    : w.taskJob
  const panel = dockWindow?.panel
  const title = locked ? task?.label || task?.task || "노드" : "노드"
  useEffect(() => {
    if (panel && panel.title !== title) panel.api.setTitle(title)
  }, [panel, title])
  useEffect(
    () => panel && registerLockTarget(panel.id, () => task?.id),
    [panel, task?.id]
  )

  if (!w.ready)
    return (
      <div className="inspector-pane">
        {w.loadError ? (
          <Blank>설정을 불러오지 못했습니다.</Blank>
        ) : (
          <div
            role="status"
            aria-label="설정 불러오는 중"
            className="flex h-full flex-col gap-6 overflow-hidden p-4"
          >
            <Skeleton className="h-6 w-1/2 shrink-0" />
            <Skeleton className="h-9 w-full shrink-0" />
            {[0, 1, 2, 3].map((field) => (
              <div
                key={field}
                aria-hidden="true"
                className="flex flex-col gap-3"
              >
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-9 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        )}
      </div>
    )
  if (!task || !catalog)
    return (
      <div className="inspector-pane">
        <Blank
          action={
            <Button variant="outline" onClick={() => w.setAddOpen(true)}>
              작업 추가
            </Button>
          }
        >
          {locked ? "잠근 노드가 삭제되었습니다" : "설정할 작업을 선택하세요"}
        </Blank>
      </div>
    )

  function focusError() {
    const key = w.taskError.match(/(?:ccdproc\.)?([A-Za-z][\w]*)[:=]/)?.[1]
    const selectedSpec = catalog?.tasks.find((spec) => spec.name === task?.task)
    const isInput = selectedSpec?.inputs.some((input) => input.name === key)
    if (isInput && task && key) requestInput(task.id, key)
    else setInspectorTab(isInput ? "input" : "settings")
    const find = () =>
      key
        ? document.querySelector(
            `[id="editor-preprocess-${key}"], [id="editor-task-${key}"], [id="source-${key}"], [id="expr-${key}"]`
          )
        : null
    const focus = () => {
      const el =
        find() ||
        document.querySelector(".task-inspector [role=tabpanel] input")
      if (el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center" })
        el.focus()
      }
    }
    if (!find() && key) {
      const toggle = document.querySelector(
        `[aria-label="${key} 파일과 표현식 펼치기"]`
      )
      if (toggle instanceof HTMLButtonElement) toggle.click()
    }
    requestAnimationFrame(focus)
  }
  function setInputSource(
    role: string,
    source: Source | { kind: "expression"; value: string }
  ) {
    if (!task || !catalog) return
    try {
      const m = w.editor.getMap()
      const value = source.kind === "expression" ? source.value : ""
      const connected =
        parsePort(role, "input") && source.kind !== "expression"
          ? connectInputPort(
              m,
              catalog,
              w.rows,
              task.id,
              role,
              source,
              source.kind !== "files"
            )
          : connect(
              m,
              task.id,
              role,
              source.kind === "expression"
                ? { kind: "files", ids: [], label: "" }
                : source,
              source.kind === "pending" &&
                !!connectionRoles(
                  catalog.tasks.find((s) => s.name === task.task)!,
                  catalog
                ).find((s) => s.name === role)?.multiple
            )
      const next = {
        ...connected,
        tasks: connected.tasks.map((t) =>
          t.id === task.id
            ? {
                ...t,
                expressions: {
                  ...t.expressions,
                  [parsePort(role, "input")?.role || role]: value,
                },
              }
            : t
        ),
      }
      w.update(() => next, `${task.label} 입력 변경`)
      w.setTaskError("")
    } catch (e) {
      w.setTaskError((e as Error).message)
    }
  }

  const { origin, returnEdited } = w.assetViewer
  return (
    <div className="inspector-pane">
      <TaskInspector
        key={task.id}
        inputRequest={
          inputRequest?.taskId === task.id ? inputRequest : undefined
        }
        activeTab={locked ? undefined : inspectorTab}
        onTabChange={locked ? undefined : setInspectorTab}
        onSelectNode={(id) => {
          w.selectNode(id)
          w.setTaskError("")
        }}
        catalog={catalog}
        map={w.map}
        task={task}
        rows={w.rows}
        edit={(fn) => w.edit(fn, task.id)}
        reorderInput={(role, ids) =>
          w.update(
            (m) => replaceRoleInputs(m, task.id, role, ids, w.rows),
            `${task.label} 입력 순서 변경`
          )
        }
        pick={w.pick}
        onOpen={w.assetViewer.open}
        onRun={() => w.run(task.id)}
        busy={w.workflowBusy || w.busy || !!(taskJob && activeJob(taskJob))}
        error={w.taskError}
        onErrorFocus={focusError}
        job={taskJob}
        saveDefaults={() => w.saveTaskDefaults(task)}
        onRemove={() => w.remove(task.id)}
        onDuplicate={() => w.duplicate(task.id)}
        onInputSource={setInputSource}
        checking={w.checking}
      />
      {!locked &&
        origin?.editorId === task.id &&
        w.taskJob?.products?.some((p) => p.asset === "image") && (
          <div className="p-4">
            <Button onClick={returnEdited}>
              <ArrowLeft data-icon="inline-start" />이 결과로 입력 교체
            </Button>
          </div>
        )}
    </div>
  )
}
