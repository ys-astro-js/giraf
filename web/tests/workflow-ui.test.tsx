import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  ParamControl,
  ParameterTable,
  TaskInspector,
} from "../src/components/task-inspector"
import { WorkbenchToolbar } from "../src/components/workbench-toolbar"
import { SidebarProvider } from "../src/components/ui/sidebar"
import { TooltipProvider } from "../src/components/ui/tooltip"
import { TaskMapView } from "../src/components/task-map-view"
import { addTask, connect, emptyMap, makeInstance, publishRun } from "../src/lib/task-map"
import type { Catalog, Param, Preferences, Spec } from "../src/lib/workbench"

const p: Param = {
  name: "process",
  default: "yes",
  type: "b",
  choices: [],
  prompt: "Process before combining?",
  min: "",
  max: "",
}
const spec: Spec = {
  name: "ccdproc",
  title: "CCD 보정",
  package: "noao.imred.ccdred",
  parameters: [p],
  inputs: [
    { name: "images", label: "입력 영상", multiple: true, kind: "image" },
  ],
  output: { name: "output", mode: "each", default: "p_" },
  kind: "image",
}
const catalog: Catalog = {
  version: "test",
  tasks: [spec],
  ccdproc: { parameters: [p], inputs: [] },
  ccdred: [],
  exam: {},
}
const prefs: Preferences = {
  drafts: {},
  backend: "cl",
  mapping: {},
  instrument: [],
  packageValues: {},
}
const task = makeInstance(spec, catalog, prefs, "a"),
  map = addTask(emptyMap(), task),
  noop = () => {}

test('combine inspector promotes process and collapses inactive preprocessing details',()=>{
 const dark={...spec,name:'darkcombine',preprocess:true,parameters:[p],inputs:[{name:'input',label:'결합할 영상',kind:'image',multiple:true}]}
 const c={...catalog,tasks:[dark],ccdproc:{inputs:[],parameters:[{...p,name:'overscan',default:'no'},{...p,name:'biassec',type:'s'}]}}
 const t=makeInstance(dark,c,prefs,'dark');t.draft.parameters.process='no'
 const html=renderToStaticMarkup(<TaskInspector catalog={c} map={addTask(emptyMap(),t)} task={t} rows={[]} edit={noop} pick={noop} onOpen={noop} onRun={noop} busy={false} error="" onErrorFocus={noop} saveDefaults={noop} onRemove={noop} reorderInput={noop}/> )
 expect(html).toContain('process');expect(html).not.toContain('결합 전 보정');expect(html).not.toContain('id="preprocess-biassec"')
 expect(html).not.toContain('id="preprocess-overscan"')
})

test("boolean IRAF parameters are switches with an accessible name", () => {
  const html = renderToStaticMarkup(
    <ParamControl p={p} id="process" value="yes" onChange={noop} />
  )
  expect(html).toContain('role="switch"')
  expect(html).toContain('aria-checked="true"')
})
test("parameter editor is a labeled form without a parallel defaults table", () => {
  const html = renderToStaticMarkup(
    <ParameterTable
      parameters={[p]}
      values={{ process: "no" }}
      scope="all"
      change={noop}
    />
  )
  expect(html).not.toContain("<table")
  expect(html).toContain('for="all-process"')
  expect(html).toContain("초기화")
  expect(html).not.toContain("초안에서 변경")
})
test("inspector exposes expression and file selection immediately, with concise copy", () => {
  const html = renderToStaticMarkup(
    <TaskInspector
      catalog={catalog}
      map={map}
      task={task}
      rows={[]}
      edit={noop}
      pick={noop}
      onOpen={noop}
      onRun={noop}
      busy={false}
      error=""
      onErrorFocus={noop}
      saveDefaults={noop}
      onRemove={noop}
      reorderInput={noop}
    />
  )
  expect(html).not.toContain('id="expr-images"')
  expect(html).toContain("입력 선택")
  expect(html).not.toContain("이 초안은 자동 저장됩니다")
  expect(html).not.toContain("실효 설정")
  expect(html).toContain("작업 삭제")
  expect(html).not.toContain('aria-label="작업 이름"')
})
test("inspector run action is a secondary icon button without a visible label", () => {
  const html = renderToStaticMarkup(
    <TaskInspector
      catalog={catalog}
      map={map}
      task={task}
      rows={[]}
      edit={noop}
      pick={noop}
      onOpen={noop}
      onRun={noop}
      busy={false}
      error=""
      onErrorFocus={noop}
      saveDefaults={noop}
      onRemove={noop}
      reorderInput={noop}
    />
  )
  const runButton = html.match(/<button[^>]*aria-label="실행"[^>]*>[\s\S]*?<\/button>/)?.[0]
  expect(runButton).toBeDefined()
  expect(runButton).toContain("size-9")
  expect(runButton).toContain("bg-secondary")
  expect(runButton).not.toMatch(/>\s*실행\s*</)
})
test("selected workflow node exposes movement and deletion without a selected badge", () => {
  const html = renderToStaticMarkup(
    <TaskMapView
      map={map}
      catalog={catalog}
      rows={[]}
      update={noop}
      add={noop}
      link={noop}
      open={noop}
      removeLink={noop}
      remove={noop}
    />
  )
  expect(html).toContain("ccdproc 이동")
  expect(html).toContain("ccdproc 삭제")
  expect(html).not.toContain("선택됨")
  expect(html).not.toContain("연결선은 입력 관계입니다")
})

test("connected input has one source control without file picker, expression or result selection", () => {
  const upstream = { ...task, id: "upstream", label: "zerocombine" }
  const linked = connect(addTask(map, upstream), task.id, "images", { kind: "pending", taskId: upstream.id }, false)
  const html = renderToStaticMarkup(<TaskInspector catalog={catalog} map={linked} task={task} rows={[]} edit={noop} pick={noop} onOpen={noop} onRun={noop} busy={false} error="" onErrorFocus={noop} saveDefaults={noop} onRemove={noop} reorderInput={noop} />)
  expect(html).toContain("zerocombine 출력")
  expect(html).not.toContain('id="expr-images"')
  expect(html).not.toContain('images 파일 선택')
  expect(html).not.toContain('결과 선택')
  expect(html).not.toContain('zerocombine 열기')
})
test("workflow toolbar combines navigation, folder, search, run and panel controls", () => {
 const html=renderToStaticMarkup(<TooltipProvider><SidebarProvider><WorkbenchToolbar folder="/data/observations" ready search="" onSearch={noop} onFolder={noop} workflowBusy={false} runDisabled={false} onRun={noop} onCancel={noop} settingsVisible trayOpen={false} onSettings={noop} onTray={noop}/></SidebarProvider></TooltipProvider>)
 expect(html).toContain('aria-label="도구 막대"')
 expect(html).toContain('폴더 열기')
 expect(html).toContain('observations')
 expect(html).toContain('작업 검색')
 expect(html).not.toContain('자동 배치')
 expect(html).toContain('aria-label="일괄 실행"')
 expect(html).not.toMatch(/>\s*일괄 실행\s*</)
 expect(html).toContain('data-slot="button-group"')
 expect(html).not.toContain('data-slot="toggle-group"')
 const panels=html.slice(html.indexOf('aria-label="패널 표시"'))
 expect(panels).not.toContain('aria-pressed')
 expect(panels).not.toContain('aria-expanded=')
 expect(panels).toContain('하단 패널 열기')
 expect(panels).toContain('설정 패널 닫기')
 expect(html.indexOf('폴더 열기')).toBeLessThan(html.indexOf('aria-label="일괄 실행"'))
 expect(html.indexOf('aria-label="일괄 실행"')).toBeLessThan(html.indexOf('작업 검색'))
 expect(html.indexOf('하단 패널 열기')).toBeLessThan(html.indexOf('설정 패널 닫기'))
 expect(html).not.toContain('GIRAF')
})

test("canvas has no second toolbar even with a saved list preference", () => {
 const listMap={...map,view:{...map.view,mode:"list" as const}}
 const html=renderToStaticMarkup(<TaskMapView map={listMap} catalog={catalog} rows={[]} update={noop} add={noop} link={noop} open={noop} removeLink={noop} remove={noop} />)
 expect(html).not.toContain("목록 보기")
 expect(html).not.toContain("작업 추가")
 expect(html).not.toContain('map-toolbar')
 expect(html).not.toContain('작업 검색')
 expect(html).toContain('자동 배치')
 expect(html).not.toContain('일괄 실행')
})

test("node identity is editable only in inspector while original command stays readable", () => {
 const renamed={...task,label:"과학 영상 보정",description:"Bias와 Dark 적용"};
 const custom={...map,tasks:[renamed]};
 const panel=renderToStaticMarkup(<TaskInspector catalog={catalog} map={custom} task={renamed} rows={[]} edit={noop} pick={noop} onOpen={noop} onRun={noop} busy={false} error="" onErrorFocus={noop} saveDefaults={noop} onRemove={noop} reorderInput={noop}/>);
 expect(panel).toContain('aria-label="제목과 설명 편집"');
 expect(panel).not.toContain('id="node-title"');
 expect(panel).toContain('과학 영상 보정');
 expect(panel).not.toContain('id="node-description"');
 expect(panel).toContain('Bias와 Dark 적용');
 expect(panel).not.toContain('원본 명령');
 expect(panel).toMatch(/title="[^"]*ccdproc"/);
 const canvas=renderToStaticMarkup(<TaskMapView map={custom} catalog={catalog} rows={[]} update={noop} add={noop} link={noop} open={noop} removeLink={noop} remove={noop}/>);
 expect(canvas).toContain('Bias와 Dark 적용');
 expect(canvas).toContain('과학 영상 보정');
 expect(canvas).not.toContain('aria-label="노드 제목"');
 expect(canvas).not.toContain('contenteditable');
});
test("legacy descriptions use catalog default and explicit empty descriptions stay empty",()=>{
 const render=(t:typeof task & {description?:string})=>renderToStaticMarkup(<TaskMapView map={{...map,tasks:[t]}} catalog={catalog} rows={[]} update={noop} add={noop} link={noop} open={noop} removeLink={noop} remove={noop}/>);
 expect(render(task)).toContain('CCD 보정');
 expect(render({...task,description:""})).not.toContain('CCD 보정');
});
