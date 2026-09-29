import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { daoeditSession, daoeditPayload, parseDaoedit, daoeditColumns } from "../src/lib/daoedit"
import { DaoeditMeasurements } from "../src/features/viewer/DaoeditMeasurements"

const header = "# XCENTER YCENTER SKY SKYSIGMA FWHM COUNTS MAG"
const line = "32.25 30.75 100.0 2.50 4.73 85617.7 -12.331"
const payload = { task: "noao.digiphot.daophot.daoedit", backend: "pyraf", inputs: { image: [] }, expressions: { image: "star.fits" }, parameters: { cache: "yes" }, parameterSets: { $package: { verbose: "yes" } } }
const effective = { inputs: { image: ["star"] }, rows: [{ id: "star", label: "star.fits", asset: "image" }] }

test("image-only daoedit opens a viewer with resolved input; scripted runs stay scripted", () => {
  const session = daoeditSession(payload, effective)
  expect(session?.frame.id).toBe("star")
  expect(session?.payload.inputs.image).toEqual(["star"])
  expect(session?.payload.expressions).toEqual({})
  for (const extra of [{ cursorCommands: { icommands: "q\n" } }, { inputs: { image: ["star"], icommands: ["commands"] } }, { expressions: { gcommands: "commands.txt" } }, { task: "other.daoedit" }]) {
    expect(daoeditSession({ ...payload, ...extra }, effective)).toBeNull()
  }
})

test("measurement uses native a/q cursor replay without mutating the selected settings", () => {
  const session = daoeditSession(payload, effective)!
  const before = JSON.stringify(session)
  const request = daoeditPayload(session, 32.25, 30.75)
  expect(request.cursorCommands.icommands).toBe("32.25 30.75 1 a\n0 0 1 q\n")
  expect(request.backend).toBe("pyraf")
  expect(request.parameters).toEqual(payload.parameters)
  expect(JSON.stringify(session)).toBe(before)
  for (const x of [NaN, Infinity, 0]) expect(() => daoeditPayload(session, x, 1)).toThrow()
})

test("seven native columns preserve precision, negative magnitudes and INDEF", () => {
  const rows = parseDaoedit(`1 2 3 4 5 6 7\n${header}\n${line}\n${header}\n33 31 INDEF INDEF 4.7 1.2D+4 INDEF\n`)
  expect(rows).toHaveLength(2)
  expect(daoeditColumns.map(c => rows[0][c])).toEqual(line.split(" "))
  expect(rows[1].mag).toBe("INDEF")
  expect(rows[1].counts).toBe("1.2D+4")
  expect(parseDaoedit(`${header}\nNaN 1 2 3 4 5 6\n1 2 3 4 5 6\n`)).toEqual([])
  expect(parseDaoedit("ERROR: unable to open image")).toEqual([])
})

test("measurement table exposes all values and accessible star selection", () => {
  const rows = parseDaoedit(`${header}\n${line}\n32 31 100 0 4 INDEF INDEF`)
  const html = renderToStaticMarkup(<DaoeditMeasurements measurements={rows} selected={0} onSelect={() => {}} />)
  for (const key of daoeditColumns) expect(html).toContain(key)
  for (const value of line.split(" ")) expect(html).toContain(value)
  expect(html).toContain("INDEF")
  expect(html).toContain('aria-label="1번 별 선택"')
  expect(html).toContain('aria-pressed="true"')
  expect(renderToStaticMarkup(<DaoeditMeasurements measurements={[]} selected={null} onSelect={() => {}} />)).toContain("영상에서 별을 선택해 주세요")
})
