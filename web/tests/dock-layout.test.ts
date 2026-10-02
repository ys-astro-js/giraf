import { GlobalRegistrator } from "@happy-dom/global-registrator"
import { afterAll, beforeEach, expect, test } from "bun:test"

// dockview builds real DOM; it runs on happy-dom here, laid out by hand.
GlobalRegistrator.register()
afterAll(() => GlobalRegistrator.unregister())

const { DockviewComponent } = await import("dockview-core")
const {
  buildDefault,
  canDrop,
  canvasGroup,
  columnGroups,
  COLUMN,
  dockPosition,
  fitColumn,
  MIN_CANVAS,
} = await import("../src/features/dock/layout")

type Dock = InstanceType<typeof DockviewComponent>
let dock: Dock

const WINDOWS = ["workflow", "inspector", "viewer"].map((id) => ({
  id,
  component: id,
  title: id,
}))

beforeEach(() => {
  const element = document.createElement("div")
  document.body.replaceChildren(element)
  dock = new DockviewComponent(element, {
    disableAutoResizing: true,
    createComponent: () => ({
      element: document.createElement("div"),
      init() {},
    }),
  })
  dock.layout(1200, 800)
  buildDefault(dock.api, WINDOWS)
  fitColumn(dock.api, COLUMN)
})

const column = () => columnGroups(dock.api)
const canvas = () => canvasGroup(dock.api)!

/** What the dock shell does when the workbench resizes. */
function resize(width: number, height: number) {
  dock.layout(width, height)
  fitColumn(dock.api, COLUMN)
}

test("the default layout: canvas, node window above the viewer", () => {
  expect(column().map((group) => group.activePanel?.id)).toEqual([
    "inspector",
    "viewer",
  ])
  expect(column()[0].width).toBe(COLUMN)
  expect(canvas().width).toBe(1200 - COLUMN)
  expect(canvas().header.hidden).toBe(true)
  expect(canvas().locked).toBe("no-drop-target")
})

test("the column keeps its pixels as the workbench resizes", () => {
  for (const [width, height] of [
    [1600, 800],
    [900, 600],
    [1400, 1000],
    [1200, 800],
  ]) {
    resize(width, height)
    expect(column()[0].width).toBe(COLUMN)
    expect(canvas().width).toBe(width - COLUMN)
  }
})

test("dockview alone would drift the column, which is why it is fitted", () => {
  dock.layout(1600, 800)
  expect(column()[0].width).not.toBe(COLUMN)
})

test("the canvas keeps its minimum on a narrow workbench, and the column comes back", () => {
  resize(600, 800)
  expect(canvas().width).toBe(MIN_CANVAS)
  resize(1200, 800)
  expect(column()[0].width).toBe(COLUMN)
})

test("an emptied group leaves; the other fills the column at the same width", () => {
  dock.getGroupPanel("viewer")!.api.close()
  expect(column()).toHaveLength(1)
  expect(column()[0].width).toBe(COLUMN)
  expect(column()[0].height).toBe(800)
})

test("a closed kind reopens in its place: node windows above viewers", () => {
  dock.getGroupPanel("inspector")!.api.close()
  dock.addPanel({
    id: "inspector",
    component: "inspector",
    title: "inspector",
    position: dockPosition(dock.api, "inspector"),
  })
  fitColumn(dock.api, COLUMN)
  expect(column().map((group) => group.activePanel?.id)).toEqual([
    "inspector",
    "viewer",
  ])
  expect(column()[0].width).toBe(COLUMN)
})

test("with both closed, the canvas takes the workbench and the column returns at its width", () => {
  dock.getGroupPanel("inspector")!.api.close()
  dock.getGroupPanel("viewer")!.api.close()
  expect(canvas().width).toBe(1200)
  dock.addPanel({
    id: "viewer",
    component: "viewer",
    title: "viewer",
    position: dockPosition(dock.api, "viewer"),
  })
  fitColumn(dock.api, COLUMN)
  expect(column()[0].width).toBe(COLUMN)
  expect(canvas().width).toBe(1200 - COLUMN)
})

test("another tab of a kind joins its kind's group", () => {
  dock.addPanel({
    id: "display",
    component: "display",
    title: "display",
    position: dockPosition(dock.api, "viewer"),
  })
  expect(dock.getGroupPanel("display")!.group).toBe(
    dock.getGroupPanel("viewer")!.group
  )
})

test("maximizing fills the workbench; the column comes back at its width", () => {
  const viewer = dock.getGroupPanel("viewer")!.group
  viewer.api.maximize()
  expect(viewer.width).toBe(1200)
  resize(1400, 800)
  viewer.api.exitMaximized()
  fitColumn(dock.api, COLUMN)
  expect(column()[0].width).toBe(COLUMN)
})

test("tabs gather only with their own kind", () => {
  const inspector = dock.getGroupPanel("inspector")!
  const viewer = dock.getGroupPanel("viewer")!
  const drop = (
    panel: typeof inspector,
    on: "tab" | "header_space" | "content" | "edge",
    position: "top" | "bottom" | "left" | "right" | "center",
    target?: typeof viewer.group
  ) => canDrop(dock.api, { on, position, target, source: { panel } })
  // A node tab never joins the viewers, nor the canvas.
  expect(drop(inspector, "tab", "center", viewer.group)).toBe(false)
  expect(drop(inspector, "header_space", "center", viewer.group)).toBe(false)
  expect(drop(inspector, "content", "center", viewer.group)).toBe(false)
  expect(drop(inspector, "content", "center", canvas())).toBe(false)
  expect(drop(inspector, "content", "right", canvas())).toBe(false)
  // It may go above or below a group in the column, never beside it.
  expect(drop(inspector, "content", "top", viewer.group)).toBe(true)
  expect(drop(inspector, "content", "bottom", viewer.group)).toBe(true)
  expect(drop(inspector, "content", "left", viewer.group)).toBe(false)
  // The layout's edge only while the column is empty.
  expect(drop(viewer, "edge", "right")).toBe(false)
  // Its own kind takes it as a tab.
  expect(drop(viewer, "tab", "center", viewer.group)).toBe(true)
  const display = dock.addPanel({
    id: "display",
    component: "display",
    title: "display",
    floating: { position: { left: 40, top: 40 }, width: 300, height: 200 },
  })
  expect(drop(display, "tab", "center", viewer.group)).toBe(true)
  expect(drop(display, "tab", "center", inspector.group)).toBe(false)
  // The canvas itself never moves.
  expect(
    canDrop(dock.api, {
      on: "content",
      position: "top",
      target: viewer.group,
      source: { group: canvas() },
    })
  ).toBe(false)
})

test("a floating window docks back as a tab of its kind, or into the column", () => {
  const display = dock.addPanel({
    id: "display",
    component: "display",
    title: "display",
    floating: { position: { left: 40, top: 40 }, width: 300, height: 200 },
  })
  expect(display.group.api.location.type).toBe("floating")
  dock.getGroupPanel("viewer")!.api.close()
  const target = dockPosition(dock.api, "viewer")
  expect(target).toMatchObject({ direction: "below" })
  display.group.api.moveTo({ group: column()[0], position: "bottom" })
  fitColumn(dock.api, COLUMN)
  expect(column().map((group) => group.activePanel?.id)).toEqual([
    "inspector",
    "display",
  ])
  expect(column()[0].width).toBe(COLUMN)
})
