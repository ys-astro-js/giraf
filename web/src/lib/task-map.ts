import {matchesFiles, type CustomOutputPort} from "./output-ports"
import {matchesGroup} from "./calibration-ports"
import type {CalibrationGroup} from "./calibration-ports"
import { acceptsAsset } from "./workbench"
import {
  defaults,
  makeDraft,
  type Catalog,
  type Draft,
  type Frame,
  type Job,
  type Preferences,
  type Spec,
  type Values,
} from "./workbench";

export type Source = {files?:string[];group?:CalibrationGroup;port?:string} & (
  | { kind: "files"; ids: string[]; label: string }
  | {
      kind: "result";
      outputRole?: string;
      taskId?: string;
      runId: string;
      ids: string[];
      label?: string;
    }
  | { kind: "pending"; taskId: string; outputRole?: string });
export type Connection = {
  targetGroup?:CalibrationGroup;
  id: string;
  target: string;
  role: string;
  source: Source;
};
export type Instance = {
  outputPorts?: CustomOutputPort[];
  parameterSets?: Record<string, Values>;
  id: string;
  task: string;
  label: string;
  description?: string;
  draft: Draft;
  preprocess: Draft;
  mapping: Values;
  instrument: string[];
  packageValues: Values;
  backend: string;
  expressions: Record<string, string>;
  filePolicy: { mode: "copy" | "direct"; backup: boolean };
  position?: { x: number; y: number };
  collapsed?: boolean;
  subflowId?: string;
};
export type MapRun = {
  id: string;
  instanceId: string;
  state: string;
  products: Frame[];
};
export type SubflowColor = "teal" | "blue" | "violet" | "amber" | "rose" | "slate";
export type Subflow = {
  color?: SubflowColor;
  id: string;
  name: string;
  position: { x: number; y: number };
  width: number;
  height: number;
};
export type TaskMap = {
  subflows?: Subflow[];
  version: 1;
  tasks: Instance[];
  connections: Connection[];
  runs: MapRun[];
  view: {
    selected: string;
    coordinateSystem?: "react-flow";
    mode: "map" | "list";
    zoom: number;
    x: number;
    y: number;
    focus: boolean;
  };
};
const clone = <T>(v: T): T => structuredClone(v);
export const uid = () => crypto.randomUUID();
export const emptyMap = (): TaskMap => ({
  version: 1,
  tasks: [],
  connections: [],
  runs: [],
  view: { selected: "", mode: "map", zoom: 1, x: 0, y: 0, focus: false },
});
export function makeInstance(
  spec: Spec,
  catalog: Catalog,
  prefs: Preferences,
  id = uid(),
): Instance {
  const proc = catalog.tasks.find((t) => t.name === "ccdproc")!;
  const preprocess = makeDraft(proc, prefs.drafts.ccdproc);

  return clone({
    id,
    task: spec.name,
    label: spec.taskName || spec.name,
    parameterSets: Object.fromEntries((spec.parameterSets || []).map(s=>[s.name,{...defaults(s.parameters),...prefs.parameterSets?.[spec.name]?.[s.name]}])),
    draft: makeDraft(spec, prefs.drafts[spec.name]),
    preprocess,
    mapping: prefs.mapping,
    instrument: prefs.instrument,
    packageValues: { ...defaults(catalog.ccdred), ...prefs.packageValues },
    backend: prefs.backend,
    expressions: {},
    filePolicy: { mode: "copy", backup: true },
  });
}
export function resetInstanceParameters(task: Instance, spec: Spec): Instance {
  return {
    ...task,
    draft: {...task.draft, parameters: defaults(spec.parameters)},
    parameterSets: spec.adapter === "generic"
      ? Object.fromEntries((spec.parameterSets || []).map(group => [group.name, defaults(group.parameters)]))
      : task.parameterSets,
  };
}
export function addTask(map: TaskMap, task: Instance): TaskMap {
  return {
    ...map,
    tasks: [...map.tasks, clone(task)],
    view: { ...map.view, selected: task.id },
  };
}
export function connectionRoles(spec: Spec, catalog: Catalog) {
  return [
    ...spec.inputs,
    ...(spec.preprocess
      ? catalog.ccdproc.inputs.filter(
          (s) => !spec.inputs.some((x) => x.name === s.name),
        )
      : []),
  ];
}
export function connect(
  map: TaskMap,
  target: string,
  role: string,
  source: Source,
  append = true,
  targetGroup?:CalibrationGroup,
): TaskMap {
  if (!map.tasks.some((t) => t.id === target))
    throw Error("대상 task가 없습니다.");
  const parent = source.kind !== "files" ? source.taskId : undefined;
  if (parent) {
    const reaches = (id: string, seen = new Set<string>()): boolean => {
      if (id === parent) return true;
      if (seen.has(id)) return false;
      seen.add(id);
      return map.connections.some(
        (c) =>
          c.source.kind !== "files" &&
          c.source.taskId === id &&
          reaches(c.target, seen),
      );
    };
    if (reaches(target)) throw Error("순환 연결은 만들 수 없습니다.");
  }
  const connections = append
    ? map.connections
    : map.connections.filter((c) => c.target !== target || c.role !== role);
  return {
    ...map,
    connections: [
      ...connections.filter(c => !(c.source.kind === 'files' && !c.source.ids.length) && !(c.target === target && c.role === role && JSON.stringify(c.source) === JSON.stringify(source))),
      ...(source.kind === 'files' && !source.ids.length ? [] : [{ id: uid(), target, role, source: clone(source), ...(targetGroup?{targetGroup}: {}) }]),
    ],
    tasks: map.tasks.map((t) =>
      t.id !== target
        ? t
        : {
            ...t,
            expressions: { ...t.expressions, [role]: "" },
            draft: { ...t.draft, inputs: { ...t.draft.inputs, [role]: [] } },
            preprocess: {
              ...t.preprocess,
              inputs: { ...t.preprocess.inputs, [role]: [] },
            },
          },
    ),
  };
}
export function replaceRoleInputs(
  map: TaskMap,
  target: string,
  role: string,
  ids: string[],
  rows: Frame[],
): TaskMap {
  const prior = map.connections
    .filter((c) => c.target === target && c.role === role)
    .map((c) => c.source);
  const sources: Source[] = [];
  for (const id of ids) {
    const old = prior.find((s) => s.kind !== "pending" && s.ids.includes(id)),
      row = rows.find((r) => r.id === id);
    const source: Source =
      old && old.kind !== "pending"
        ? { ...old, ids: [id] }
        : row?.job
          ? { kind: "result", runId: row.job, ids: [id] }
          : { kind: "files", label: "선택한 자료", ids: [id] };
    const last = sources.at(-1);
    if (
      last &&
      last.kind !== "pending" &&
      JSON.stringify({ ...last, ids: [] }) ===
        JSON.stringify({ ...source, ids: [] })
    )
      last.ids.push(id);
    else sources.push(source);
  }
  const cleared = connect(
    map,
    target,
    role,
    { kind: "files", ids: [], label: "" },
    false,
  );
  return {
    ...cleared,
    connections: [
      ...cleared.connections.filter(
        (c) => c.target !== target || c.role !== role,
      ),
      ...sources.map((source) => ({ id: uid(), target, role, source })),
    ],
  };
}
export function disconnect(map: TaskMap, id: string): TaskMap {
  return { ...map, connections: map.connections.filter((c) => c.id !== id) };
}
/** Remove confirmed deleted assets without disconnecting an upstream task. */
export function removeLibraryReferences(map: TaskMap, fileIds: Set<string>, jobIds: Set<string>): TaskMap {
  const removed = new Set([...fileIds, ...map.runs.filter(run=>jobIds.has(run.id)).flatMap(run=>run.products.map(p=>p.id))]);
  const inputs = (values: Record<string,string[]>) => Object.fromEntries(
    Object.entries(values).map(([role,ids])=>[role,ids.filter(id=>!removed.has(id))]));
  return {
    ...map,
    tasks: map.tasks.map(task=>({...task,
      draft:{...task.draft,inputs:inputs(task.draft.inputs)},
      preprocess:{...task.preprocess,inputs:inputs(task.preprocess.inputs)},
    })),
    runs: map.runs.filter(run=>!jobIds.has(run.id)).map(run=>({...run,products:run.products.filter(p=>!removed.has(p.id))})),
    connections: map.connections.flatMap(connection=>{
      const source=connection.source;
      if(source.kind==='pending') return [connection];
      const ids=source.ids.filter(id=>!removed.has(id));
      if(ids.length) return [{...connection,source:{...source,ids}}];
      if(source.kind==='result' && source.taskId && map.tasks.some(t=>t.id===source.taskId)) {
        const {runId: _runId, ids: _ids, ...selector}=source;
        return [{...connection,source:{...selector,kind:'pending' as const,taskId:source.taskId}}];
      }
      return [];
    }),
  };
}
/** Saved documents retain run snapshots; the execution library is authoritative. */
export function reconcileRuns(map: TaskMap, jobs: Pick<Job, 'id' | 'state' | 'products'>[]): TaskMap {
  const actual = new Map(jobs.map(job => [job.id, job]));
  const deleted = new Set(map.runs.filter(run => !actual.has(run.id)).map(run => run.id));
  const removedProducts = new Set(map.runs.flatMap(run => {
    const job = actual.get(run.id);
    return job ? run.products.filter(product => !job.products.some(p => p.id === product.id)).map(p => p.id) : [];
  }));
  const cleaned = removeLibraryReferences(map, removedProducts, deleted);
  return {...cleaned, runs: cleaned.runs.map(run => {
    const job = actual.get(run.id)!;
    return {...run, state: job.state, products: job.products};
  })};
}
export function replacePending(
  map: TaskMap,
  id: string,
  runId: string,
  ids: string[],
): TaskMap {
  const run = map.runs.find((r) => r.id === runId);
  if (!run || ids.some((id) => !run.products.some((p) => p.id === id)))
    throw Error("해당 실행의 실제 결과를 선택해 주세요.");
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
        : c,
    ),
  };
}
export function publishRun(
  map: TaskMap,
  instanceId: string,
  run: Pick<Job, "id" | "state" | "products">,
): TaskMap {
  const record = {
    id: run.id,
    instanceId,
    state: run.state,
    products: clone(run.products || []),
  };
  return {
    ...map,
    runs: map.runs.some((r) => r.id === run.id)
      ? map.runs.map((r) => (r.id === run.id ? record : r))
      : [...map.runs, record],
  };
}
export function inputResults(map: TaskMap, taskId: string, kind: string) {
  return map.runs
    .filter((run) => run.instanceId === taskId && run.state === "completed")
    .flatMap((run) =>
      run.products
        .filter((p) => acceptsAsset(kind, p.asset) && p.role !== "$log")
        .map((product) => ({ runId: run.id, product })),
    );
}
export function publishWorkflowRun(map: TaskMap, instanceId: string, run: Pick<Job, "id" | "state" | "products">, catalog: Catalog): TaskMap {
  const published = publishRun(map, instanceId, run);
  if (run.state !== "completed") return published;
  return {...published, connections: published.connections.map(c => {
    const source = c.source;
    if (source.kind === "files" || source.taskId !== instanceId) return c;
    const target = published.tasks.find(t => t.id === c.target);
    const spec = catalog.tasks.find(s => s.name === target?.task);
    const slot = spec && connectionRoles(spec, catalog).find(s => s.name === c.role);
    if (!slot) return c;
    const products = (run.products || []).filter(p => p.role !== "$log" && matchesFiles(p, source.files) && acceptsAsset(slot.kind, p.asset) &&
      (!source.outputRole || p.role === source.outputRole) && (!source.group || matchesGroup(p, source.group)));
    if (!products.length || (!slot.multiple && products.length > 1)) {
      if (source.files !== undefined) {
        return {...c,source:{kind:"pending" as const,taskId:instanceId,port:source.port,files:source.files,...(source.group?{group:source.group}:{}),...(source.outputRole?{outputRole:source.outputRole}:{})}};
      }
      return c;
    }
    return {...c, source: {...source, kind: "result" as const, taskId: instanceId, runId: run.id, ids: products.map(p => p.id)}};
  })};
}
/** Resolve an unbound node against its latest run without changing pinned results. */
export function resolvedSource(map: TaskMap, source: Source, kind?: string): Source {
  if (source.kind !== "pending") return source;
  const run = map.runs.filter(r => r.instanceId === source.taskId).at(-1);
  if (!run || run.state !== "completed") return source;
  const products = run.products.filter(p => p.role !== "$log" && matchesFiles(p, source.files) &&
    (!source.outputRole || p.role === source.outputRole) &&
    (!source.group || matchesGroup(p,source.group)) &&
    (!kind || acceptsAsset(kind, p.asset)));
  return products.length ? {
    ...source, kind: "result", taskId: source.taskId, runId: run.id,
    ids: products.map(p => p.id), ...(source.outputRole ? {outputRole:source.outputRole} : {}),
  } : source;
}

export function payloadFor(map: TaskMap, id: string, catalog: Catalog) {
  const t = map.tasks.find((t) => t.id === id);
  if (!t) throw Error("task를 선택해 주세요.");
  const spec = catalog.tasks.find((s) => s.name === t.task)!;
  if (!spec) throw Error("설치된 작업 정의를 찾지 못했습니다. 작업 목록을 새로고침해 주세요.");
  const inputs = clone(t.draft.inputs);
  if (spec.preprocess)
    for (const s of catalog.ccdproc.inputs)
      inputs[s.name] = clone(t.preprocess.inputs[s.name] || []);
  const roles = connectionRoles(spec, catalog);
  for (const slot of roles) {
    const links = map.connections.filter(
      (c) => c.target === id && c.role === slot.name,
    ).map(c => ({...c, source: resolvedSource(map, c.source, slot.kind)}));
    const flag = (
      {
        zero: "zerocor",
        dark: "darkcor",
        flat: "flatcor",
        illum: "illumcor",
        fringe: "fringecor",
        fixfile: "fixpix",
      } as Record<string, string>
    )[spec.adapter === "generic" && spec.name !== "ccdproc" ? "" : slot.name];
    const usesPrep =
      t.task === "ccdproc" ||
      (spec.preprocess &&
        (t.draft.parameters.process === "yes" || t.task.startsWith("mk")));
    const requiredNow =
      !flag ||
      (usesPrep &&
        (t.task === "ccdproc" ? t.draft : t.preprocess).parameters[flag] ===
          "yes") ||
      (t.task === "mkskyflat" && slot.name === "flat");
    if (
      requiredNow &&
      !t.expressions[slot.name] &&
      links.some((c) => c.source.kind === "pending")
    ) {
      const waiting = links.find((c) => c.source.kind === "pending")!;
      const sourceId =
        waiting.source.kind === "pending" ? waiting.source.taskId : "";
      const sourceName =
        map.tasks.find((t) => t.id === sourceId)?.label || "연결한 작업";
      throw Error(`${slot.name}: 연결한 작업의 사용 가능한 결과가 없습니다. 캔버스에서 ‘${sourceName}’ 작업을 선택하고 실행해 주세요.`);
    }
    if (links.length) {
      inputs[slot.name] = links.flatMap((c) =>
        c.source.kind !== "pending" ? c.source.ids : [],
      );
      if (requiredNow && !t.expressions[slot.name] && !slot.multiple && inputs[slot.name].length > 1) {
        throw Error(`${slot.name}: 파일 한 개가 필요합니다. 입력 항목을 열고 ‘파일’ → ‘찾아보기…’에서 사용할 결과 파일 하나를 선택해 주세요.`);
      }
    }
    inputs[slot.name] ??= [];
  }
  if(spec.adapter !== "generic") inputs.instrument = clone(t.instrument);
  return taskPayload(t, inputs);
}

// Execution and live inspection serialize the same settings, but only execution
// requires all connections to be ready and valid before building a request.
function taskPayload(t: Instance, inputs: Record<string, string[]>) {
  return clone({
    calibration: undefined,
    task: t.task,
    outputs: clone(t.draft.outputs || {}),
    cursorCommands: clone(t.draft.cursorCommands || {}),
    textInputs: clone(t.draft.textInputs || {}),
    alignmentBinding: t.draft.alignmentBinding ? clone(t.draft.alignmentBinding) : undefined,
    parameterSets: clone(t.parameterSets || {}),
    instanceId: t.id,
    backend: t.backend,
    inputs,
    parameters: t.draft.parameters,
    output: t.draft.output,
    ccdproc:
      t.task === "ccdproc" ? t.draft.parameters : t.preprocess.parameters,
    ccdred: t.packageValues,
    mapping: t.mapping,
    section: t.draft.section,
    exam: t.draft.exam,
    expressions: t.expressions,
    filePolicy: t.filePolicy,
  });
}
export function restoreRun(
  map: TaskMap,
  job: {
    id: string;
    task?: string;
    manifest?: Partial<ReturnType<typeof payloadFor>> & {inputSelections?:Record<string,string[]>};
  },
  catalog: Catalog,
  prefs: Preferences,
  id = uid(),
) {
  const m = job.manifest;
  if (!m?.task) throw Error("실행 설정이 없습니다.");
  const restoredSpec = catalog.tasks.find((t) => t.name === m.task);
  if (!restoredSpec) throw Error("기록에 사용된 패키지를 설치한 뒤 작업 목록을 새로고침해 주세요.");
  const t = makeInstance(
    restoredSpec,
    catalog,
    prefs,
    id,
  );
  t.label = t.task + " 기록 복원";
  t.draft = makeDraft(
    catalog.tasks.find((s) => s.name === t.task)!,
    {...m, inputs:m.inputSelections || m.inputs} as Partial<Draft>,
  );
  t.preprocess.parameters = clone(m.ccdproc || t.preprocess.parameters);
  t.preprocess.inputs = clone(m.inputs || {});
  t.packageValues = clone(m.ccdred || t.packageValues);
  t.parameterSets = clone(m.parameterSets || t.parameterSets);
  t.mapping = clone(m.mapping || t.mapping);
  t.backend = m.backend || t.backend;
  t.instrument = clone(m.inputs?.instrument || []);
  t.expressions = clone(m.expressions || {});
  return addTask(map, t);
}
export function migrateMap(prefs: Preferences, catalog: Catalog): TaskMap {
  if (prefs.taskMap?.version === 1) {
    const map = clone(prefs.taskMap);
    map.connections = map.connections.filter(c=>c.source.kind!=='files' || c.source.ids.length>0);
    map.tasks = map.tasks.map(t => {
      const spec = catalog.tasks.find(s => s.name === t.task);
      return spec?.adapter === 'generic' ? {...t, draft: makeDraft(spec, t.draft),
        parameterSets: Object.fromEntries((spec.parameterSets || []).map(group => [group.name, {...defaults(group.parameters), ...t.parameterSets?.[group.name]}]))} : t;
    });
    return map;
  }
  let m = emptyMap();
  for (const spec of catalog.tasks)
    if (
      Object.values(prefs.drafts[spec.name]?.inputs || {}).some(
        (ids) => ids.length,
      )
    )
      m = addTask(m, makeInstance(spec, catalog, prefs));
  return m;
}
export function layoutMap(
  map: TaskMap,
): { id: string; x: number; y: number }[] {
  const levels = new Map<string, number>();
  const depth = (id: string, seen = new Set<string>()): number => {
    if (levels.has(id)) return levels.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const parents = map.connections
      .filter((c) => c.target === id && c.source.kind !== "files")
      .map((c) =>
        c.source.kind === "pending" || c.source.kind === "result"
          ? c.source.taskId
          : undefined,
      )
      .filter((v): v is string => !!v && map.tasks.some((t) => t.id === v));
    const d = parents.length
      ? Math.max(...parents.map((p) => depth(p, new Set(seen)))) + 1
      : 0;
    levels.set(id, d);
    return d;
  };
  const slots = new Map<number, number>();
  return map.tasks.map((t) => {
    const d = depth(t.id),
      i = slots.get(d) || 0;
    slots.set(d, i + 1);
    return {
      id: t.id,
      ...(t.position || { x: 40 + d * 320, y: 40 + i * 200 }),
    };
  });
}
export const stateLabel = (state: string) =>
  ({
    queued: "준비 중",
    running: "실행 중",
    waiting: "사용자 입력 대기",
    completed: "완료",
    processed: "처리됨",
    skipped: "건너뜀",
    partial: "부분 실패",
    failed: "실패",
    cancelled: "중단됨",
    planned: "처리 계획",
    draft: "실행 전",
  })[state] || state;

/** Commit one movement, translating pointer displacement at the current zoom. */
export function moveTask(
  map: TaskMap,
  id: string,
  origin: { x: number; y: number },
  delta: { x: number; y: number },
  zoom: number,
): TaskMap {
  const scale = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const position = {
    x: Math.max(24, origin.x + delta.x / scale),
    y: Math.max(24, origin.y + delta.y / scale),
  };
  if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return map;
  return {
    ...map,
    tasks: map.tasks.map((t) => (t.id === id ? { ...t, position } : t)),
  };
}
export function removeTask(map: TaskMap, id: string): TaskMap {
  const index = map.tasks.findIndex((t) => t.id === id);
  if (index < 0) return map;
  const tasks = map.tasks.filter((t) => t.id !== id);
  return {
    ...map,
    tasks,
    connections: map.connections
      .filter(
        (c) =>
          c.target !== id &&
          !(c.source.kind === "pending" && c.source.taskId === id),
      )
      .map((c) => {
        if (c.source.kind !== "result" || c.source.taskId !== id) return c;
        const { taskId: _, ...source } = c.source;
        return { ...c, source };
      }),
    view: {
      ...map.view,
      selected:
        map.view.selected === id
          ? tasks[Math.min(index, tasks.length - 1)]?.id || ""
          : map.view.selected,
    },
  };
}
/** Restore a deletion without reverting subsequent edits or asynchronous runs. */
export function restoreTask(
  map: TaskMap,
  before: TaskMap,
  id: string,
): TaskMap {
  const task = before.tasks.find((t) => t.id === id);
  if (!task || map.tasks.some((t) => t.id === id)) return map;
  const tasks = [...map.tasks];
  tasks.splice(
    Math.min(before.tasks.indexOf(task), tasks.length),
    0,
    clone(task),
  );
  const affected = before.connections.filter(
    (c) =>
      c.target === id || (c.source.kind !== "files" && c.source.taskId === id),
  );
  const connections = [...map.connections];
  for (const c of affected) {
    if (!tasks.some((t) => t.id === c.target)) continue;
    const existing = connections.findIndex((x) => x.id === c.id);
    if (existing >= 0) {
      // Reattach provenance only; never replace edited file selections.
      const current = connections[existing];
      if (
        current.source.kind === "result" &&
        c.source.kind === "result" &&
        current.source.runId === c.source.runId
      )
        connections[existing] = {
          ...current,
          source: { ...current.source, taskId: id },
        };
      continue;
    }
    if (map.connections.some((x) => x.target === c.target && x.role === c.role))
      continue;
    if (
      c.source.kind === "pending" &&
      !tasks.some(
        (t) => t.id === ("taskId" in c.source ? c.source.taskId : undefined),
      )
    )
      continue;
    connections.push(clone(c));
  }
  return { ...map, tasks, connections, view: { ...map.view, selected: id } };
}

export function workflowRequest(
  map: TaskMap,
  catalog: Catalog,
  workingDirectory: string,
) {
  const links = map.connections.flatMap((c) => {
    if (c.source.kind === "files" || !c.source.taskId) return [];
    const sourceId = c.source.taskId;
    if (!map.tasks.some((t) => t.id === sourceId)) return [];
    const target = map.tasks.find((t) => t.id === c.target)!;
    const spec = catalog.tasks.find((s) => s.name === target.task)!;
    const role = connectionRoles(spec, catalog).find((s) => s.name === c.role);
    if (!role || target.expressions[c.role]) return [];
    const flag = (
      {
        zero: "zerocor",
        dark: "darkcor",
        flat: "flatcor",
        illum: "illumcor",
        fringe: "fringecor",
        fixfile: "fixpix",
      } as Record<string, string>
    )[spec.adapter === "generic" && spec.name !== "ccdproc" ? "" : c.role];
    const prep = target.task === "ccdproc" ? target.draft : target.preprocess;
    if (
      flag &&
      !(target.task === "mkskyflat" && c.role === "flat") &&
      !(
        (target.task === "ccdproc" ||
          (spec.preprocess &&
            (target.draft.parameters.process === "yes" ||
              target.task.startsWith("mk")))) &&
        prep.parameters[flag] === "yes"
      )
    )
      return [];
    return [
      {
        source: c.source.taskId,
        ...(c.source.files !== undefined ? {sourceFiles:c.source.files} : {}),
        ...(c.source.group ? {sourceGroup:c.source.group}: {}),
        ...(c.source.outputRole ? {sourceRole:c.source.outputRole} : {}),
        target: c.target,
        role: c.role,
        kind: role.kind,
        multiple: role.multiple,
      },
    ];
  });
  const prepared = {
    ...map,
    connections: map.connections.map((c) =>
      c.source.kind === "pending" ||
      links.some((l) => l.target === c.target && l.role === c.role)
        ? { ...c, source: { kind: "files" as const, ids: [], label: "" } }
        : c,
    ),
  };
  return {
    nodes: map.tasks.map((t) => ({
      id: t.id,
      label: t.label,
      payload: { ...payloadFor(prepared, t.id, catalog), workingDirectory },
    })),
    links,
  };
}

/** The live checker receives every edge, including ones the run planner excludes. */
export function workflowDiagnosticRequest(map: TaskMap, catalog: Catalog, workingDirectory: string) {
  const connections = map.connections.map(connection => {
    const task = map.tasks.find(task => task.id === connection.target)
    const spec = catalog.tasks.find(spec => spec.name === task?.task)
    const role = spec && connectionRoles(spec, catalog).find(role => role.name === connection.role)
    return { ...connection, source: resolvedSource(map, connection.source, role?.kind) }
  })
  return {
    workingDirectory,
    nodes: map.tasks.map(task => {
      const spec = catalog.tasks.find(spec => spec.name === task.task)
      const inputs = clone(task.draft.inputs)
      if (spec?.preprocess)
        for (const slot of catalog.ccdproc.inputs)
          inputs[slot.name] = clone(task.preprocess.inputs[slot.name] || [])
      const incoming = connections.filter(connection => connection.target === task.id)
      for (const role of new Set(incoming.map(connection => connection.role)))
        inputs[role] = incoming.filter(connection => connection.role === role).flatMap(connection =>
          connection.source.kind === "pending" ? [] : connection.source.ids)
      if (spec && spec.adapter !== "generic") inputs.instrument = clone(task.instrument)
      return {
        id: task.id,
        label: task.label,
        payload: { ...taskPayload(task, inputs), workingDirectory },
      }
    }),
    connections,
  }
}

export function workflowDiagnosticSignature(map: TaskMap, workingDirectory: string) {
  return JSON.stringify({
    workingDirectory,
    tasks: map.tasks.map(task => {
      const content = { ...task }
      delete content.position
      delete content.collapsed
      delete content.subflowId
      return content
    }),
    connections: map.connections,
    runs: map.runs,
  })
}
