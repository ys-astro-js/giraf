// Regression contracts written before implementation.
import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  addTask,
  connect,
  emptyMap,
  makeInstance,
  publishRun,
} from "../src/lib/task-map"
import {
  connectionChoices,
  nodeOutput,
  nodeGeometry,
  nodeLayout,
  fitNodes,
} from "../src/lib/node-interaction"
import { TaskResults } from "../src/components/task-results"
import { TaskMapView } from "../src/components/task-map-view"
import type { Catalog, Preferences, Spec, Frame } from "../src/lib/workbench"
const image: Spec = {
  name: "ccdproc",
  title: "CCD 보정",
  package: "ccdred",
  parameters: [],
  inputs: [
    { name: "images", label: "보정할 영상", kind: "image", multiple: true },
    { name: "zero", label: "Bias 영상", kind: "image", multiple: false },
    { name: "fixfile", label: "불량 픽셀", kind: "text", multiple: false },
  ],
  output: { name: "output", mode: "each", default: "p_" },
  kind: "image",
}
const combine: Spec = {
  ...image,
  name: "zerocombine",
  title: "Bias 결합",
  inputs: [
    { name: "input", label: "결합할 영상", kind: "image", multiple: true },
  ],
  output: { name: "output", mode: "single", default: "zero" },
  preprocess: false,
}
const textSpec: Spec = {
  ...combine,
  name: "imstatistics",
  kind: "text",
  output: null,
}
const catalog: Catalog = {
  version: "test",
  tasks: [image, combine, textSpec],
  ccdproc: { parameters: [], inputs: image.inputs },
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
function fixture() {
  let m = emptyMap()
  for (const [s, id] of [
    [combine, "a"],
    [image, "b"],
    [combine, "c"],
    [textSpec, "text"],
  ] as const)
    m = addTask(m, makeInstance(s, catalog, prefs, id))
  return m
}
const product = (id: string, asset = "image"): Frame => ({
  id,
  label: id + ".fits",
  asset,
})
const noop = () => {}
test("output connections infer the node output before its first run", () => {
  expect(nodeOutput(fixture(), "a")).toEqual({ kind: "pending", taskId: "a" })
})
test("latest completed output includes all reusable products and run provenance", () => {
  let m = publishRun(fixture(), "a", {
    id: "r1",
    state: "completed",
    products: [product("old")],
  })
  m = publishRun(m, "a", {
    id: "r2",
    state: "completed",
    products: [
      product("one"),
      product("two"),
      product("plot", "plot"),
      product("report", "text"),
    ],
  })
  expect(nodeOutput(m, "a")).toEqual({
    kind: "result",
    taskId: "a",
    runId: "r2",
    ids: ["one", "two"],
  })
})
test("single active compatible input is the only choice; inactive corrections excluded", () => {
  expect(
    connectionChoices(
      fixture(),
      catalog,
      { kind: "pending", taskId: "a" },
      "b",
      []
    ).map((s) => s.name)
  ).toEqual(["images"])
})
test("multiple active compatible inputs remain choices without changing the map", () => {
  const m = fixture()
  m.tasks.find((t) => t.id === "b")!.draft.parameters.zerocor = "yes"
  expect(
    connectionChoices(
      m,
      catalog,
      { kind: "pending", taskId: "a" },
      "b",
      []
    ).map((s) => s.name)
  ).toEqual(["images", "zero"])
  expect(m.connections).toEqual([])
})
test("text output cannot feed an image input", () => {
  expect(() =>
    connectionChoices(
      fixture(),
      catalog,
      { kind: "pending", taskId: "text" },
      "c",
      []
    )
  ).toThrow("입력")
})
test("known multiple outputs cannot silently become a scalar input", () => {
  let m = fixture()
  m.tasks.find((t) => t.id === "b")!.draft.parameters.zerocor = "yes"
  m = publishRun(m, "a", {
    id: "r",
    state: "completed",
    products: [product("x"), product("y")],
  })
  expect(
    connectionChoices(m, catalog, nodeOutput(m, "a"), "b", []).map(
      (s) => s.name
    )
  ).toEqual(["images"])
})
test("self links and cycle targets are rejected before connection", () => {
  let m = fixture()
  expect(() =>
    connectionChoices(m, catalog, { kind: "pending", taskId: "a" }, "a", [])
  ).toThrow()
  m = connect(m, "b", "images", { kind: "pending", taskId: "a" })
  expect(() =>
    connectionChoices(m, catalog, { kind: "pending", taskId: "b" }, "a", [])
  ).toThrow("순환")
})
test("deleted and malformed sources fail without changing the map", () => {
  const m = fixture()
  expect(() =>
    connectionChoices(m, catalog, { kind: "pending", taskId: "gone" }, "b", [])
  ).toThrow()
  expect(() =>
    connectionChoices(
      m,
      catalog,
      { kind: "files", ids: ["missing"], label: "x" },
      "b",
      []
    )
  ).toThrow()
  expect(m.connections).toEqual([])
})
test("reconnecting preserves other inputs and clears only the role expression", () => {
  let m = fixture()
  m.tasks.find((t) => t.id === "b")!.expressions.images = "@old"
  m = connect(m, "b", "zero", { kind: "files", ids: ["bias"], label: "bias" })
  m = connect(m, "b", "images", { kind: "pending", taskId: "a" }, false)
  expect(m.tasks.find((t) => t.id === "b")!.expressions.images).toBe("")
  expect(m.connections.find((c) => c.role === "zero")?.source).toMatchObject({
    ids: ["bias"],
  })
})
test("role ports have separate anchors and output remains below inputs", () => {
  const m = fixture()
  m.tasks.find((t) => t.id === "b")!.draft.parameters.zerocor = "yes"
  const g = nodeGeometry(
    m,
    m.tasks.find((t) => t.id === "b")!,
    catalog
  )
  expect(g.inputY("zero")).toBeGreaterThan(g.inputY("images"))
  expect(g.outputY).toBeGreaterThan(g.inputY("zero"))
  expect(g.height-24).toBe(g.outputY)
})
test("layout accounts for variable heights and preserves manual positions", () => {
  const m = fixture()
  m.tasks[0].position = { x: 777, y: 333 }
  expect(nodeLayout(m, catalog)[0]).toMatchObject({ x: 777, y: 333 })
  m.tasks[0].position = { x: 40, y: 40 }
  m.tasks[1].position = { x: 40, y: 240 }
  const repaired = nodeLayout(m, catalog)
  expect(repaired[1].y).toBeGreaterThan(repaired[0].y + repaired[0].height)
  const auto = nodeLayout(
    { ...m, tasks: m.tasks.map((t) => ({ ...t, position: undefined })) },
    catalog
  )
  for (let i = 1; i < auto.length; i++)
    expect(auto[i].y).toBeGreaterThanOrEqual(
      auto[i - 1].y + nodeGeometry(m, m.tasks[i - 1], catalog).height
    )
})
test("fit includes complete cards at narrow sizes", () => {
  const p = nodeLayout(fixture(), catalog),
    f = fitNodes(p, 320, 480)
  expect(f.zoom).toBeGreaterThan(0)
  for (const n of p) {
    expect((n.x + n.width) * f.zoom).toBeLessThanOrEqual(320)
    expect((n.y + n.height) * f.zoom).toBeLessThanOrEqual(480)
  }
})
test("cards name each input and separate results from connection", () => {
  const m = fixture()
  m.tasks.find((t) => t.id === "b")!.draft.parameters.zerocor = "yes"
  const html = renderToStaticMarkup(
    <TaskMapView
      map={m}
      catalog={catalog}
      rows={[]}
      update={noop}
      add={noop}
      link={noop}
      open={noop}
      remove={noop}
      removeLink={noop}
    />
  )
  expect(html).toContain('<span class="node-input-label">zero</span>')
  expect(html).not.toContain("Bias 영상")
  expect(html).not.toContain("connection-notice")
  expect(html).not.toContain("연결할 입력을 선택하세요")
  expect(html).not.toContain("결과 보기")
  expect(html).toContain('data-input-role="zero"')
  expect(html).toContain("ccdproc 출력 연결")
  expect(html).toContain("CCD 보정")
})
test("right results panel shows all products without file cache or linking dialog", () => {
  const m = publishRun(fixture(), "b", {
    id: "run",
    state: "completed",
    products: [product("first"), product("second")],
  })
  const html = renderToStaticMarkup(<TaskResults map={m} task={m.tasks[1]} />)
  expect(html).toContain("first.fits")
  expect(html).toContain("second.fits")
  expect(html).toContain("결과 2개")
  expect(html).not.toContain("입력 연결")
  expect(html).not.toContain('role="dialog"')
})
test("results distinguish never-run, failed and empty runs without old output fallback", () => {
  const m = fixture(),
    t = m.tasks[0]
  expect(renderToStaticMarkup(<TaskResults map={m} task={t} />)).toContain(
    "아직 실행하지 않았습니다"
  )
  const failed = publishRun(
    publishRun(m, "a", {
      id: "old",
      state: "completed",
      products: [product("old")],
    }),
    "a",
    { id: "new", state: "failed", products: [] }
  )
  const html = renderToStaticMarkup(<TaskResults map={failed} task={t} />)
  expect(html).toContain("실패")
  expect(html).not.toContain("old.fits")
  expect(
    renderToStaticMarkup(
      <TaskResults
        map={publishRun(m, "a", { id: "r", state: "completed", products: [] })}
        task={t}
      />
    )
  ).toContain("생성된 결과 파일이 없습니다")
})

test("completed status and typed output count share the footer without a result button", () => {
  const m = publishRun(fixture(), "a", {id:"r",state:"completed",products:[product("out"),product("report","text")]})
  const html = renderToStaticMarkup(<TaskMapView map={m} catalog={catalog} rows={[]} update={noop} add={noop} link={noop} open={noop} remove={noop} removeLink={noop}/>);
  const node = html.split('aria-label="zerocombine 노드"')[1].split('</article>')[0];
  expect(node.split('</header>')[0]).not.toContain('완료');
  expect(node.split('class="node-footer"')[1]).toContain('aria-label="완료"');
  expect(node.split('class="node-footer"')[1]).toContain('lucide-check');
  expect(node.replace(/<svg[\s\S]*?<\/svg>/g, '')).not.toContain('>완료<');
  expect(node).not.toContain(' · ');
  expect(node.split('class="node-footer"')[1]).toContain('aria-label="1개 항목"');
  expect(node.split('class="node-footer"')[1]).toContain('lucide-file');
  expect(node).not.toContain('결과 보기');
  const multiCatalog = {...catalog, tasks:catalog.tasks.map(s => s.name==='zerocombine' ? {...s, adapter:'generic' as const, outputs:[{name:'science',kind:'image',default:'science.fits'},{name:'plots',kind:'metacode',default:'plots.gki'}]} : s)};
  const multiMap=publishRun(fixture(), 'a', {id:'multi',state:'completed',products:[{...product('out'),role:'science'},{...product('plot','metacode'),role:'plots'}]});
  const multiHtml=renderToStaticMarkup(<TaskMapView map={multiMap} catalog={multiCatalog} rows={[]} update={noop} add={noop} link={noop} open={noop} remove={noop} removeLink={noop}/>);
  const multiNode=multiHtml.split('aria-label="zerocombine 노드"')[1].split('</article>')[0];
  expect(multiNode).not.toContain('node-output-kind');
  expect(multiNode).not.toContain('>FITS<');
  expect(multiNode).not.toContain('>GKI<');
  expect(multiNode).toContain('zerocombine science 출력 연결');
  expect(multiNode).toContain('zerocombine plots 출력 연결');
  expect(multiNode.split('class="node-output-row"').slice(1).every(row=>row.includes('node-output-summary') && row.includes('1개 항목'))).toBe(true);

});
test("compact node geometry keeps each wire at its input row center", () => {
 const m=fixture(); m.tasks[1].draft.parameters.zerocor="yes";
 const g=nodeGeometry(m,m.tasks[1],catalog);
 expect(g.inputY("images")).toBe(96);
 expect(g.inputY("zero")).toBe(144);
 expect(g.height).toBe(224);
 expect(g.outputY).toBe(200);
 expect(g.outputs).toHaveLength(0);
});

test("only actively running nodes are highlighted and completion removes the running indicator", () => {
 for (const state of ["queued", "running", "waiting", "completed", "failed", "cancelled"]) {
  const m = publishRun(fixture(), "a", {id:"live",state,products:[]});
  const html=renderToStaticMarkup(<TaskMapView map={m} catalog={catalog} rows={[]} update={noop} add={noop} link={noop} open={noop} remove={noop} removeLink={noop}/>);
  const node=html.split('aria-label="zerocombine 노드"')[1].split('</article>')[0];
  expect(node).toContain(`data-running="${state === "running"}"`);
  if(state === "running") {
   expect(node).toContain('aria-label="실행 중"');
   expect(node).toContain('node-running-icon');
   expect(node).not.toContain('lucide-check');
  } else expect(node).not.toContain('node-running-icon');
 }
});
