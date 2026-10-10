import { matchesFiles } from "@/lib/output-ports"
import { acceptsAsset } from "@/lib/workbench"
import { type Catalog, type Job } from "@/lib/workbench"
import { type MapRun, type Source, type TaskMap } from "./model"
import { connectionRoles } from "./connections"
const clone = <T,>(value: T): T => structuredClone(value)

/** Remove confirmed deleted assets without disconnecting an upstream task. */
export function removeLibraryReferences(
  map: TaskMap,
  fileIds: Set<string>,
  jobIds: Set<string>
): TaskMap {
  const removed = new Set([
    ...fileIds,
    ...map.runs
      .filter((run) => jobIds.has(run.id))
      .flatMap((run) => run.products.map((p) => p.id)),
  ])
  const inputs = (values: Record<string, string[]>) =>
    Object.fromEntries(
      Object.entries(values).map(([role, ids]) => [
        role,
        ids.filter((id) => !removed.has(id)),
      ])
    )
  return {
    ...map,
    tasks: map.tasks.map((task) => ({
      ...task,
      draft: { ...task.draft, inputs: inputs(task.draft.inputs) },
      preprocess: {
        ...task.preprocess,
        inputs: inputs(task.preprocess.inputs),
      },
    })),
    runs: map.runs
      .filter((run) => !jobIds.has(run.id))
      .map((run) => ({
        ...run,
        products: run.products.filter((p) => !removed.has(p.id)),
      })),
    connections: map.connections.flatMap((connection) => {
      const source = connection.source
      if (source.kind === "pending") return [connection]
      const ids = source.ids.filter((id) => !removed.has(id))
      if (ids.length) return [{ ...connection, source: { ...source, ids } }]
      if (
        source.kind === "result" &&
        source.taskId &&
        map.tasks.some((t) => t.id === source.taskId)
      ) {
        const { runId: _runId, ids: _ids, ...selector } = source
        return [
          {
            ...connection,
            source: {
              ...selector,
              kind: "pending" as const,
              taskId: source.taskId,
            },
          },
        ]
      }
      return []
    }),
  }
}

type RunJob = Pick<Job, "id" | "state" | "products"> & Partial<Pick<Job, "execution" | "manifest">>

/** The workflow run a job was a step of. */
const workflowOf = (job: RunJob) => job.manifest?.workflowId || job.execution?.id || undefined

/**
 * A task's latest results. Inside loop regions a workflow run runs the task
 * once per round; leaving the regions, every round's results go on together,
 * each with its round's labels, so all runs of that workflow run count (the
 * newest per round).
 */
export function latestRun(map: TaskMap, taskId: string | undefined): MapRun | undefined {
  const rounds = latestRuns(map, taskId)
  const last = rounds.at(-1)
  return last && rounds.length > 1 ? { ...last, products: rounds.flatMap((r) => r.products) } : last
}

/** The runs `latestRun` gathers, oldest first: the latest run, or every round's of its workflow run. */
export function latestRuns(map: TaskMap, taskId: string | undefined): MapRun[] {
  const own = map.runs.filter((r) => r.instanceId === taskId)
  const last = own.at(-1)
  if (!last?.workflow || last.state !== "completed") return last ? [last] : []
  const rounds = new Map<string, MapRun>()
  for (const run of own)
    if (run.workflow === last.workflow && run.state === "completed") {
      // One run per round; runs recorded without their round's labels count apart.
      const labels = run.products.find((p) => p.labels)?.labels
      const key = labels ? JSON.stringify(labels) : run.id
      rounds.delete(key)
      rounds.set(key, run)
    }
  return [...rounds.values()]
}

/**
 * Saved documents retain run snapshots; the execution library is authoritative.
 * With `catalog`, a connection holding the last round's results of a workflow
 * run takes every round's (documents saved before rounds were gathered).
 */
export function reconcileRuns(map: TaskMap, jobs: RunJob[], catalog?: Catalog): TaskMap {
  const reconciled = reconcileRecords(map, jobs)
  if (!catalog) return reconciled
  let bound = reconciled
  for (const taskId of new Set(reconciled.runs.map((run) => run.instanceId))) {
    const rounds = latestRuns(reconciled, taskId)
    const last = rounds.at(-1)
    if (rounds.length > 1 && last)
      bound = bindWorkflowOutputs(bound, taskId, last, catalog, (source) => holdsWholeRun(source, last))
  }
  return bound
}

/** A connection bound to all of a run's results of its kind, not to files picked from them. */
function holdsWholeRun(source: Source, run: MapRun) {
  if (source.kind !== "result" || source.runId !== run.id) return false
  const held = run.products.filter((p) => source.ids.includes(p.id))
  return held.length > 0 && run.products.every((p) =>
    source.ids.includes(p.id) || p.role === "$log" || !matchesFiles(p, source.files) ||
    (!!source.outputRole && p.role !== source.outputRole) || !held.some((h) => (h.asset ?? "image") === (p.asset ?? "image")))
}

function reconcileRecords(map: TaskMap, jobs: RunJob[]): TaskMap {
  const actual = new Map(jobs.map((job) => [job.id, job]))
  const deleted = new Set(
    map.runs.filter((run) => !actual.has(run.id)).map((run) => run.id)
  )
  const removedProducts = new Set(
    map.runs.flatMap((run) => {
      const job = actual.get(run.id)
      return job
        ? run.products
            .filter((product) => !job.products.some((p) => p.id === product.id))
            .map((p) => p.id)
        : []
    })
  )
  const cleaned = removeLibraryReferences(map, removedProducts, deleted)
  return {
    ...cleaned,
    runs: cleaned.runs.map((run) => {
      const job = actual.get(run.id)!
      const workflow = run.workflow ?? workflowOf(job)
      return { ...run, state: job.state, products: job.products, ...(workflow ? { workflow } : {}) }
    }),
  }
}

export function replacePending(
  map: TaskMap,
  id: string,
  runId: string,
  ids: string[]
): TaskMap {
  const run = map.runs.find((r) => r.id === runId)
  if (!run || ids.some((id) => !run.products.some((p) => p.id === id)))
    throw Error("해당 실행의 실제 결과를 선택해 주세요.")
  return {
    ...map,
    connections: map.connections.map((c) =>
      c.id === id
        ? {
            ...c,
            source: {
              kind: "result",
              taskId: run.instanceId,
              runId,
              ids: clone(ids),
            },
          }
        : c
    ),
  }
}

export function publishRun(map: TaskMap, instanceId: string, run: RunJob): TaskMap {
  const workflow = workflowOf(run)
  const record = {
    id: run.id,
    instanceId,
    state: run.state,
    products: clone(run.products || []),
    ...(workflow ? { workflow } : {}),
  }
  return {
    ...map,
    runs: map.runs.some((r) => r.id === run.id)
      ? map.runs.map((r) => (r.id === run.id ? record : r))
      : [...map.runs, record],
  }
}

export function inputResults(map: TaskMap, taskId: string, kind: string) {
  return map.runs
    .filter((run) => run.instanceId === taskId && run.state === "completed")
    .flatMap((run) =>
      run.products
        .filter((p) => acceptsAsset(kind, p.asset) && p.role !== "$log")
        .map((product) => ({ runId: run.id, product }))
    )
}

export function publishWorkflowRun(
  map: TaskMap,
  instanceId: string,
  run: RunJob,
  catalog: Catalog
): TaskMap {
  const published = publishRun(map, instanceId, run)
  return bindWorkflowOutputs(published, instanceId, run, catalog)
}

/** Project current workflow results without copying execution records into edit history. */
export function bindWorkflowOutputs(
  published: TaskMap,
  instanceId: string,
  run: Pick<Job, "id" | "state" | "products">,
  catalog: Catalog,
  eligible: (source: Source) => boolean = () => true
): TaskMap {
  if (run.state !== "completed") return published
  // Every round's results of the workflow run this run was a step of.
  const latest = latestRun(published, instanceId)
  const results = latest?.id === run.id ? latest.products : run.products || []
  return {
    ...published,
    connections: published.connections.map((c) => {
      const source = c.source
      if (
        source.kind === "files" ||
        source.taskId !== instanceId ||
        !eligible(source)
      )
        return c
      const target = published.tasks.find((t) => t.id === c.target)
      const spec = catalog.tasks.find((s) => s.name === target?.task)
      const slot =
        spec && connectionRoles(spec, catalog).find((s) => s.name === c.role)
      if (!slot) return c
      const products = results.filter(
        (p) =>
          p.role !== "$log" &&
          matchesFiles(p, source.files) &&
          acceptsAsset(slot.kind, p.asset) &&
          (!source.outputRole || p.role === source.outputRole)
      )
      if (!products.length || (!slot.multiple && products.length > 1)) {
        if (source.files !== undefined) {
          return {
            ...c,
            source: {
              kind: "pending" as const,
              taskId: instanceId,
              port: source.port,
              files: source.files,
              ...(source.outputRole ? { outputRole: source.outputRole } : {}),
            },
          }
        }
        return c
      }
      return {
        ...c,
        source: {
          ...source,
          kind: "result" as const,
          taskId: instanceId,
          runId: run.id,
          ids: products.map((p) => p.id),
        },
      }
    }),
  }
}

/** Resolve an unbound node against its latest run without changing pinned results. */
export function resolvedSource(
  map: TaskMap,
  source: Source,
  kind?: string
): Source {
  if (source.kind !== "pending") return source
  // A pass output carries its input files as they are now, without a run.
  const passed = source.outputRole
    ? map.tasks.find((t) => t.id === source.taskId)?.passed?.[source.outputRole]
    : undefined
  // A port's file filter matches labels the run publishes, so it waits for that run.
  if (passed && (!source.files || source.files.every((f) => f === "*")))
    return passed.length ? { ...source, kind: "result", runId: "", ids: passed } : source
  const run = latestRun(map, source.taskId)
  if (!run || run.state !== "completed") return source
  const products = run.products.filter(
    (p) =>
      p.role !== "$log" &&
      matchesFiles(p, source.files) &&
      (!source.outputRole || p.role === source.outputRole) &&
      (!kind || acceptsAsset(kind, p.asset))
  )
  return products.length
    ? {
        ...source,
        kind: "result",
        taskId: source.taskId,
        runId: run.id,
        ids: products.map((p) => p.id),
        ...(source.outputRole ? { outputRole: source.outputRole } : {}),
      }
    : source
}
