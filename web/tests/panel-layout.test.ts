import { expect, test } from "bun:test"
import { readPanelLayout, savePanelLayout } from "../src/lib/panel-layout"

test("panel preferences retain independent pixel widths and visibility across reloads", () => {
  const data = new Map<string, string>()
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value)
    },
  }
  savePanelLayout(
    {
      libraryWidth: 480,
      inspectorWidth: 380,
      libraryOpen: false,
      inspectorOpen: true,
    },
    storage
  )
  expect(readPanelLayout(storage)).toEqual({
    libraryWidth: 480,
    inspectorWidth: 380,
    libraryOpen: false,
    inspectorOpen: true,
  })
  savePanelLayout({ libraryOpen: true }, storage)
  expect(readPanelLayout(storage)).toEqual({
    libraryWidth: 480,
    inspectorWidth: 380,
    libraryOpen: true,
    inspectorOpen: true,
  })
})
test("unavailable or malformed browser storage does not break the workbench", () => {
  expect(readPanelLayout({ getItem: () => "{broken" })).toEqual({})
  expect(
    readPanelLayout({
      getItem: () =>
        '{"libraryWidth":-1,"inspectorWidth":"400","libraryOpen":"false"}',
    })
  ).toEqual({})
  expect(
    readPanelLayout({
      getItem: () => '{"libraryWidth":900,"inspectorWidth":700}',
    })
  ).toEqual({ libraryWidth: 480, inspectorWidth: 480 })
  const storage = {
    getItem: () => {
      throw new Error("blocked")
    },
    setItem: () => {
      throw new Error("blocked")
    },
  }
  expect(readPanelLayout(storage)).toEqual({})
  expect(() => savePanelLayout({ libraryWidth: 480 }, storage)).not.toThrow()
})
