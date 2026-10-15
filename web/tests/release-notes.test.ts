import { expect, test } from "bun:test"
import { inlineCode, parseReleaseNotes } from "../src/lib/app-update"

test("release notes split into headed sections of items", () => {
  const notes = "## 새 기능\n\n- 첫 항목입니다.\n- 둘째 항목입니다.\n\n## 수정\n\n- 고쳤습니다.\n"
  expect(parseReleaseNotes(notes)).toEqual([
    { title: "새 기능", items: ["첫 항목입니다.", "둘째 항목입니다."] },
    { title: "수정", items: ["고쳤습니다."] },
  ])
})

test("a wrapped line continues its item and empty sections drop", () => {
  expect(parseReleaseNotes("## 개선\n- 앞부분\n  뒷부분\n## 수정\r\n")).toEqual([
    { title: "개선", items: ["앞부분 뒷부분"] },
  ])
})

test("items before any heading and missing notes", () => {
  expect(parseReleaseNotes("- 항목")).toEqual([{ items: ["항목"] }])
  expect(parseReleaseNotes("")).toEqual([])
})

test("inline code splits out of an item", () => {
  expect(inlineCode("`문서\\GIRAF`에 남습니다 ⌘C")).toEqual([
    { code: true, text: "문서\\GIRAF" },
    { code: false, text: "에 남습니다 ⌘C" },
  ])
  expect(inlineCode("짝이 없는 ` 기호")).toEqual([{ code: false, text: "짝이 없는 ` 기호" }])
})
