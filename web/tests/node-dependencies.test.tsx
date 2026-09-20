import { beforeAll, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { emptyMap, makeInstance, type Connection } from "../src/lib/task-map"
import type { Catalog, Preferences, Spec } from "../src/lib/workbench"
import {
  dependencyGraph,
  layoutDependencies,
} from "../src/lib/node-dependencies"
import { NodeDependencies } from "../src/components/node-dependencies"
// Match the existing ELK test setup: Bun's main-thread self is not a worker.
beforeAll(async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "self")
  Reflect.deleteProperty(globalThis, "self")
  try {
    const { default: ELK } = await import("elkjs/lib/elk.bundled.js")
    new ELK()
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "self", descriptor)
  }
})
const spec: Spec = {
  name: "task",
  package: "test",
  title: "Task",
  adapter: "generic",
  kind: "image",
  parameters: [],
  inputs: [],
  output: null,
}
const catalog: Catalog = {
  version: "test",
  tasks: [spec],
  ccdproc: { parameters: [], inputs: [] },
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
const tasks = ["a", "b", "c", "d", "unrelated"].map((id) => ({
  ...makeInstance(spec, catalog, prefs, id),
  label: id,
}))
const link = (
  id: string,
  source: string,
  target: string,
  role = "input"
): Connection => ({
  id,
  target,
  role,
  source: { kind: "pending", taskId: source },
})
const map = {
  ...emptyMap(),
  tasks,
  connections: [
    link("ab", "a", "b"),
    link("bc", "b", "c"),
    link("bc2", "b", "c", "reference"),
    link("cd", "c", "d"),
  ],
}
test("direct graph deduplicates neighbors and retains actual directed edges", () => {
  const graph = dependencyGraph(map, catalog, "c", false)
  expect(graph.nodes.map((n) => n.id).sort()).toEqual(["b", "c", "d"])
  expect(graph.edges.map((e) => e.id)).toEqual(["bc", "bc2", "cd"])
})
test("full graph follows ancestors and descendants once and safely handles cycles", () => {
  const graph = dependencyGraph(
    { ...map, connections: [...map.connections, link("da", "d", "a")] },
    catalog,
    "c",
    true
  )
  expect(graph.nodes.map((n) => n.id).sort()).toEqual(["a", "b", "c", "d"])
  expect(graph.edges.length).toBe(5)
})
test("files and deleted nodes stay outside the graph but saved origins remain", () => {
  const graph = dependencyGraph(
    {
      ...map,
      connections: [
        {
          id: "saved",
          target: "c",
          role: "input",
          source: { kind: "result", taskId: "b", runId: "run", ids: [] },
        },
        link("missing", "gone", "c"),
        {
          id: "files",
          target: "c",
          role: "input",
          source: { kind: "files", ids: [], label: "files" },
        },
      ],
    },
    catalog,
    "c",
    false
  )
  expect(graph.nodes.map((n) => n.id).sort()).toEqual(["b", "c"])
  expect(graph.edges.map((e) => e.id)).toEqual(["saved"])
})
test("node labels contain name and command, only customized outputs appear beneath them", () => {
  const changed = {
    ...map,
    tasks: tasks.map((t) =>
      t.id === "c"
        ? {
            ...t,
            outputPorts: [
              { id: "$default", name: "", files: ["*"] },
              { id: "$role:aux", name: "aux", files: ["*"] },
              { id: "blue", name: "B", files: ["*B.fits"] },
            ],
          }
        : t
    ),
  }
  const node = dependencyGraph(changed, catalog, "c", false).nodes.find(
    (n) => n.id === "c"
  )!
  expect(node.data.label).toBe("c")
  expect(node.data.command).toBe("task")
  expect(node.data.outputs.map((p) => p.name)).toEqual(["B"])
})
test("inactive connections are drawn differently without adding status text", () => {
  const changed = {
    ...map,
    tasks: tasks.map((t) =>
      t.id === "c" ? { ...t, expressions: { input: "*.fits" } } : t
    ),
  }
  const graph = dependencyGraph(changed, catalog, "c", false)
  expect(
    graph.edges.find((e) => e.id === "bc")?.style?.strokeDasharray
  ).toBeDefined()
  expect(
    graph.edges.find((e) => e.id === "bc2")?.style?.strokeDasharray
  ).toBeUndefined()
})
test("ELK arranges the graph top to bottom without overlapping nodes", async () => {
  const graph = await layoutDependencies(
    dependencyGraph(map, catalog, "c", true)
  )
  const nodes = graph.nodes
  expect(nodes.find((n) => n.id === "a")!.position.y).toBeLessThan(
    nodes.find((n) => n.id === "b")!.position.y
  )
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i],
        b = nodes[j]
      expect(
        a.position.x + a.width! <= b.position.x ||
          b.position.x + b.width! <= a.position.x ||
          a.position.y + a.height! <= b.position.y ||
          b.position.y + b.height! <= a.position.y
      ).toBe(true)
    }
})
test("panel is one graph without previous/next sections or connection metadata", () => {
  const html = renderToStaticMarkup(
    <NodeDependencies
      map={map}
      catalog={catalog}
      task={tasks[2]}
      onSelect={() => {}}
    />
  )
  expect(html).not.toContain("이전 노드")
  expect(html).not.toContain("이후 노드")
  expect(html).not.toContain("저장된 결과")
  expect(html).not.toContain("의존성 불러오는 중")
  expect(html).toContain('aria-label="노드 의존성"')
})

test("custom outputs share one bottom row with separate source positions", async () => {
  const changed = {
    ...map,
    tasks: tasks.map((t) =>
      t.id === "b"
        ? {
            ...t,
            outputPorts: [
              { id: "blue", name: "B", files: ["B.fits"] },
              { id: "red", name: "R", files: ["R.fits"] },
            ],
          }
        : t
    ),
    connections: [
      {
        ...link("blue", "b", "c"),
        source: {
          kind: "pending" as const,
          taskId: "b",
          port: "output-custom:blue",
        },
      },
      {
        ...link("red", "b", "c"),
        source: {
          kind: "pending" as const,
          taskId: "b",
          port: "output-custom:red",
        },
      },
    ],
  }
  const graph = await layoutDependencies(
    dependencyGraph(changed, catalog, "b", false)
  )
  const source = graph.nodes.find((n) => n.id === "b")!
  expect(source.height).toBe(96)
  expect(source.data.sourcePorts.map((p) => p.name)).toEqual(["B", "R"])
  expect(source.data.sourcePorts[0].x).toBeLessThan(
    source.data.sourcePorts[1].x
  )
  const target = graph.nodes.find((n) => n.id === "c")!
  expect(target.data.inputPorts.length).toBe(2)
  expect(target.data.inputPorts[0].x).not.toBe(target.data.inputPorts[1].x)
  for (const edge of graph.edges) {
    const points = edge.data!.points as { x: number; y: number }[]
    const port = source.data.sourceHandles.find(
      (p) => p.id === edge.sourceHandle
    )!
    expect(points[0].x).toBeCloseTo(source.position.x + port.x)
    expect(points[0].y).toBeCloseTo(source.position.y + source.height!)
    expect(points.at(-1)!.y).toBeCloseTo(target.position.y)
    expect(points.length).toBeGreaterThan(1)
  }
})

test("direction toggles independently filter direct and full dependencies", () => {
  for (const all of [false, true]) {
    const previous = dependencyGraph(map, catalog, "c", all, { previous: true, next: false })
    expect(previous.nodes.map((n) => n.id).sort()).toEqual(all ? ["a", "b", "c"] : ["b", "c"])
    expect(previous.edges.every((e) => e.target !== "d")).toBe(true)
    const next = dependencyGraph(map, catalog, "b", all, { previous: false, next: true })
    expect(next.nodes.map((n) => n.id).sort()).toEqual(all ? ["b", "c", "d"] : ["b", "c"])
    const neither = dependencyGraph(map, catalog, "c", all, { previous: false, next: false })
    expect(neither.nodes.map((n) => n.id)).toEqual(["c"])
    expect(neither.edges).toEqual([])
  }
})

test("dependency lines and arrows use the neighboring subflow color", () => {
  const grouped = {
    ...map,
    tasks: tasks.map((task) => ({ ...task, subflowId: task.id === "b" ? "before" : task.id === "d" ? "after" : undefined })),
    subflows: [
      { id: "before", name: "Before", color: "blue" as const, position: { x: 0, y: 0 }, width: 300, height: 300 },
      { id: "after", name: "After", color: "rose" as const, position: { x: 0, y: 0 }, width: 300, height: 300 },
    ],
  }
  const graph = dependencyGraph(grouped, catalog, "c", true)
  expect(graph.nodes.find((node) => node.id === "c")!.data.color).toBe("var(--muted-foreground)")
  expect(dependencyGraph(grouped, catalog, "b", false).nodes.find((node) => node.id === "b")!.data.color).toBe("var(--subflow-blue)")
  for (const [id, color] of [["ab", "var(--muted-foreground)"], ["bc", "var(--subflow-blue)"], ["cd", "var(--subflow-rose)"]]) {
    const edge = graph.edges.find((edge) => edge.id === id)!
    expect(edge.style?.stroke).toBe(color)
    expect(typeof edge.markerEnd === "object" && edge.markerEnd.color).toBe(color)
  }
})

test("fan-out connections have separate bottom anchors and no shared line segments", async () => {
  const graph = await layoutDependencies(dependencyGraph({
    ...map,
    connections: [link("ab", "a", "b"), link("ac", "a", "c"), link("ad", "a", "d")],
  }, catalog, "a", false))
  const source = graph.nodes.find((node) => node.id === "a")!
  expect(new Set(source.data.sourceHandles.map((port) => port.x)).size).toBe(3)
  const segments = graph.edges.flatMap((edge) => {
    const points = edge.data!.points as { x: number; y: number }[]
    return points.slice(1).map((end, i) => ({ id: edge.id, start: points[i], end }))
  })
  for (const a of segments) for (const b of segments) {
    if (a.id === b.id) continue
    const vertical = a.start.x === a.end.x && b.start.x === b.end.x && a.start.x === b.start.x
    const horizontal = a.start.y === a.end.y && b.start.y === b.end.y && a.start.y === b.start.y
    if (!vertical && !horizontal) continue
    const axis = vertical ? "y" : "x"
    const overlap = Math.min(Math.max(a.start[axis], a.end[axis]), Math.max(b.start[axis], b.end[axis])) - Math.max(Math.min(a.start[axis], a.end[axis]), Math.min(b.start[axis], b.end[axis]))
    expect(overlap).toBeLessThanOrEqual(0)
  }
})

test("viewport and canvas positions do not change dependency layout input", () => {
  const original = dependencyGraph(map, catalog, "c", true)
  const moved = {
    ...map,
    view: { ...map.view, zoom: 1.5, x: 100, y: -200 },
    tasks: map.tasks.map((task) => ({ ...task, position: { x: 450, y: 600 } })),
  }
  expect(JSON.stringify(dependencyGraph(moved, catalog, "c", true))).toBe(JSON.stringify(original))
  expect(JSON.stringify(dependencyGraph({ ...map, connections: [] }, catalog, "c", true))).not.toBe(JSON.stringify(original))
})
