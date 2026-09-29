import type { Frame } from "./workbench"

export const daoeditColumns = ["xcenter", "ycenter", "sky", "skysigma", "fwhm", "counts", "mag"] as const
export type DaoeditMeasurement = Record<(typeof daoeditColumns)[number], string>
type Request = {
  task: string
  inputs: Record<string, string[]>
  expressions?: Record<string, string>
  cursorCommands?: Record<string, string>
  [key: string]: unknown
}
export type DaoeditSession = { frame: Frame; payload: Request }

export function daoeditSession(payload: Request, effective: { inputs: Record<string, string[]>; rows: Frame[] }): DaoeditSession | null {
  if (payload.task !== "noao.digiphot.daophot.daoedit") return null
  if (["icommands", "gcommands"].some(role => payload.inputs[role]?.length || payload.expressions?.[role]?.trim() || payload.cursorCommands?.[role]?.trim())) return null
  const frame = effective.rows.find(row => row.id === effective.inputs.image?.[0])
  if (!frame || frame.viewer_supported === false) throw new Error("daoedit: 뷰어에서 표시할 수 있는 2D 영상을 선택해 주세요.")
  return { frame, payload: { ...payload, inputs: effective.inputs, expressions: {} } }
}

export function daoeditPayload(session: DaoeditSession, x: number, y: number) {
  if (![x, y].every(v => Number.isFinite(v) && v >= 1)) throw new Error("영상 안의 별을 선택해 주세요.")
  return { ...session.payload, cursorCommands: { icommands: `${x} ${y} 1 a\n0 0 1 q\n` } }
}

export function parseDaoedit(text: string): DaoeditMeasurement[] {
  const measurements: DaoeditMeasurement[] = []
  let hasHeader = false
  for (const line of text.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields[0] === "#") {
      hasHeader = fields.slice(1).join(" ").toLowerCase() === daoeditColumns.join(" ")
      continue
    }
    if (!hasHeader || fields.length !== daoeditColumns.length) continue
    if (!fields.every(value => value === "INDEF" || (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eEdD][+-]?\d+)?$/.test(value) && Number.isFinite(Number(value.replace(/[dD]/, "e")))))) continue
    measurements.push(Object.fromEntries(daoeditColumns.map((key, i) => [key, fields[i]])) as DaoeditMeasurement)
  }
  return measurements
}
