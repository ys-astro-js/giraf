import { expect, test } from "bun:test"
import { inspectorTabs } from "../src/lib/inspector-tabs"
import type { Spec } from "../src/lib/workbench"

const param = (name: string) => ({ name, type: "r", default: "", choices: [], prompt: "", min: "", max: "" })
const giraf = (run: Spec["run"], inputs: Spec["inputs"] = [], extra: Partial<Spec> = {}): Spec => ({
  name: `giraf.${run}`,
  title: String(run),
  package: "giraf",
  adapter: "generic",
  run,
  parameters: [],
  inputs,
  outputs: [],
  output: null,
  kind: "any",
  ...extra,
})
const files = [{ name: "items", label: "파일", kind: "any", multiple: true, required: true }]
const tabsOf = (spec: Spec) => inspectorTabs(spec)

test("an IRAF task shows every tab", () => {
  const imstat: Spec = {
    name: "images.imutil.imstatistics",
    title: "imstatistics",
    package: "images.imutil",
    adapter: "generic",
    parameters: [param("lower")],
    inputs: [{ name: "images", label: "영상", kind: "image", multiple: true }],
    output: null,
    kind: "text",
  }
  expect(tabsOf(imstat)).toEqual(["info", "input", "output", "dependencies", "settings"])
})

test("containers show only what they hold", () => {
  // 각각 반복: its list is its input; 설정 holds the keywords it runs by.
  expect(tabsOf(giraf("foreach", files))).toEqual(["info", "input", "dependencies", "settings"])
  // 반복: a number range, no input.
  expect(tabsOf(giraf("for"))).toEqual(["info", "dependencies", "settings"])
  // 조건 분기: routed files and a condition.
  expect(tabsOf(giraf("if", [{ ...files[0], name: "input" }]))).toEqual([
    "info",
    "input",
    "dependencies",
    "settings",
  ])
})

test("value and pset nodes hand on values, not files", () => {
  expect(tabsOf(giraf("value-constant"))).toEqual(["info", "dependencies", "settings"])
  expect(tabsOf(giraf("value-header", files))).toEqual(["info", "input", "dependencies", "settings"])
  expect(tabsOf(giraf("value-compute"))).toEqual(["info", "dependencies", "settings"])
  // 설정 holds 가져오기, so it shows before a 작업 설정 node holds a pset.
  expect(tabsOf(giraf("pset"))).toEqual(["info", "dependencies", "settings"])
})

test("file nodes have no settings", () => {
  const passed = { ...files[0], sources: ["files" as const] }
  const input = giraf("pass-files", [passed], {
    outputs: [{ name: "image", kind: "image", mode: "pass", default: "" }],
  })
  expect(tabsOf(input)).toEqual(["info", "input", "output", "dependencies"])
  expect(tabsOf(giraf("save-files", files))).toEqual(["info", "input", "output", "dependencies"])
})
