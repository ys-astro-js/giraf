// Migration contracts: written before the React Flow implementation.
import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import {
  addTask,
  connect,
  emptyMap,
  makeInstance,
  publishRun,
  removeTask,
} from "../src/lib/task-map"
import {
  flowNodes,
  flowEdges,
  connectFlow,
  changeFlowNodes,
  flowViewport,
} from "../src/lib/workflow-flow"
import { TaskMapView } from "../src/components/task-map-view"
import type { Catalog, Preferences, Spec } from "../src/lib/workbench"
const spec: Spec = {
  name: "ccdproc",
  title: "CCD 보정",
  package: "ccdred",
  parameters: [],
  inputs: [
    { name: "images", label: "영상", kind: "image", multiple: true },
    { name: "zero", label: "Bias", kind: "image", multiple: false },
  ],
  output: { name: "output", mode: "each", default: "p_" },
  kind: "image",
}
const catalog: Catalog = {
  version: "test",
  tasks: [spec],
  ccdproc: { parameters: [], inputs: spec.inputs },
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
const fixture = () =>
  ["a", "b", "c"].reduce(
    (m, id) => addTask(m, makeInstance(spec, catalog, prefs, id)),
    emptyMap()
  )
const wire = {
  source: "a",
  sourceHandle: "output",
  target: "b",
  targetHandle: "images",
}
const noop = () => {}

test("saved positions including negative coordinates survive RF projection and movement", () => {
  expect(() => structuredClone(flowNodes(fixture(), catalog))).not.toThrow()
  const m = fixture()
  m.tasks[0].position = { x: -90, y: 12 }
  m.tasks[1].position = { x: -90, y: 12 }
  expect(
    flowNodes(m, catalog)
      .slice(0, 2)
      .map((n) => n.position)
  ).toEqual([
    { x: -90, y: 12 },
    { x: -90, y: 12 },
  ])
  const next = changeFlowNodes(m, catalog, [
    {
      id: "a",
      type: "position",
      position: { x: -150, y: 88 },
      dragging: false,
    },
  ])
  expect(next.tasks[0].position).toEqual({ x: -150, y: 88 })
  expect(next.connections).toEqual(m.connections)
  expect(
    changeFlowNodes(m, catalog, [
      { id: "a", type: "dimensions", dimensions: { width: 280, height: 200 } },
    ])
  ).toBe(m)
})
test("RF node selection updates the inspector without altering task data", () => {
  const m = fixture()
  const next = changeFlowNodes(m, catalog, [
    { id: "c", type: "select", selected: false },
    { id: "a", type: "select", selected: true },
  ])
  expect(next.view.selected).toBe("a")
  expect(next.tasks).toEqual(m.tasks)
})
test("named handles map to inputs and replacement clears only the selected role", () => {
  const m = fixture()
  m.tasks[1].expressions.images = "*.fits"
  m.tasks[1].expressions.zero = "bias.fits"
  const next = connectFlow(m, catalog, [], wire)
  expect(next.connections[0]).toMatchObject({
    target: "b",
    role: "images",
    source: { kind: "pending", taskId: "a" },
  })
  expect(next.tasks[1].expressions).toEqual({ images: "", zero: "bias.fits" })
  const again = connectFlow(next, catalog, [], wire)
  expect(again.connections).toHaveLength(1)
  expect(flowEdges(next, catalog)[0]).toMatchObject({
    source: "a",
    target: "b",
    sourceHandle: "output",
    targetHandle: "images",
  })
})
test("validation rejects missing ports, inactive roles, self loops and cycles", () => {
  const m = fixture()
  for (const invalid of [
    { ...wire, targetHandle: null },
    { ...wire, sourceHandle: "missing" },
    { ...wire, targetHandle: "zero" },
    { ...wire, target: "a" },
    { ...wire, source: "gone" },
  ])
    expect(() => connectFlow(m, catalog, [], invalid)).toThrow()
  const linked = connectFlow(m, catalog, [], wire)
  expect(() =>
    connectFlow(linked, catalog, [], { ...wire, source: "b", target: "a" })
  ).toThrow()
})
test("reconnection validates without the old edge and retains unrelated connections", () => {
  const m = connectFlow(
    connectFlow(fixture(), catalog, [], wire),
    catalog,
    [],
    { ...wire, source: "b", target: "c" }
  )
  const next = connectFlow(
    m,
    catalog,
    [],
    { ...wire, source: "a", target: "c" },
    m.connections[1].id
  )
  expect(next.connections).toHaveLength(2)
  expect(next.connections[0]).toEqual(m.connections[0])
  expect(next.connections[1].source).toEqual({ kind: "pending", taskId: "a" })
})
test("completed outputs retain provenance, including after source node deletion", () => {
  const m = publishRun(fixture(), "a", {
    id: "r1",
    state: "completed",
    products: [{ id: "out", label: "out.fits", asset: "image" }],
  })
  const next = connectFlow(m, catalog, [], wire)
  expect(next.connections[0].source).toEqual({
    kind: "result",
    taskId: "a",
    runId: "r1",
    ids: ["out"],
  })
  const deleted = removeTask(next, "a")
  expect(deleted.connections).toHaveLength(1)
  expect(flowEdges(deleted, catalog)).toEqual([])
})
test("filtered nodes hide their edges without changing saved graph; inactive edges remain marked", () => {
  let m = fixture()
  m.tasks[0].label = "Bias"
  m.tasks[1].draft.parameters.zerocor = "yes"
  m = connect(m, "b", "zero", { kind: "pending", taskId: "a" }, false)
  m.tasks[1].draft.parameters.zerocor = "no"
  expect(
    flowNodes(m, catalog, "Bias")
      .filter((n) => !n.hidden)
      .map((n) => n.id)
  ).toEqual(["a"])
  expect(flowEdges(m, catalog, "Bias")[0].hidden).toBe(true)
  expect(flowEdges(m, catalog)[0].className).toBe("workflow-edge-inactive")
})
test("legacy scroll offsets convert once while saved RF viewports round-trip", () => {
  const m = fixture()
  m.view = { ...m.view, x: 120, y: 40, zoom: 0.7 }
  expect(flowViewport(m.view)).toEqual({ x: -120, y: -40, zoom: 0.7 })
  expect(
    flowViewport({ ...m.view, coordinateSystem: "react-flow", x: -42, y: 80 })
  ).toEqual({ x: -42, y: 80, zoom: 0.7 })
})
test("canvas renders native RF nodes, handles, controls and background", () => {
  const html = renderToStaticMarkup(
    <TaskMapView
      map={fixture()}
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
  for (const token of [
    "react-flow__node-task",
    "react-flow__handle",
    "react-flow__controls",
    "react-flow__background",
    "react-flow__controls-fitview",
    "react-flow__controls-zoomin",
  ])
    expect(html).toContain(token)
  expect(html).not.toContain('class="diagram"')
})

test("connected input and output ports are filled, unconnected ports stay hollow", () => {
  const render = (map: ReturnType<typeof fixture>) =>
    renderToStaticMarkup(
      <TaskMapView
        map={map}
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
  const empty = render(fixture())
  expect(empty).not.toContain('data-connected="true"')
  const linked = render(connectFlow(fixture(), catalog, [], wire))
  expect(linked.match(/data-connected="true"/g)).toHaveLength(2)
  expect(linked).toContain('data-connected="false"')
})
