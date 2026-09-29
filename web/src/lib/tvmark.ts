import type { Frame, Job, Manifest, Values } from "./workbench"
import type { MarkerAppearance, ViewerMarker } from "@/features/viewer/types"

const yes = (value: unknown) => value === true || value === "yes"
const numeric = (value: string) => Number(value.replace(/[dD]/, "e"))

export const tvmarkColors = [
  { value: "201", label: "커서 흰색", color: "white" },
  ...[
    ["검정", "black"], ["흰색", "white"], ["빨강", "red"], ["초록", "green"],
    ["파랑", "blue"], ["노랑", "yellow"], ["청록", "cyan"], ["자홍", "magenta"],
    ["산호색", "coral"], ["적갈색", "maroon"], ["주황", "orange"], ["카키", "khaki"],
    ["난초색", "orchid"], ["터키색", "turquoise"], ["보라", "violet"], ["밀색", "wheat"],
  ].map(([label, color], index) => ({ value: String(202 + index), label, color })),
  { value: "255", label: "흰색", color: "rgb(255, 255, 255)" },
]

export function tvmarkPreview(manifest: Manifest): Frame | null {
  if (manifest.task !== "images.tv.tvmark") return null
  if (yes(manifest.parameters.interactive) || manifest.inputs.commands?.length || manifest.cursorCommands?.commands?.trim() || manifest.inputs.outimage?.length || manifest.inputs.font?.length || Object.values(manifest.outputs || {}).some(Boolean)) {
    throw new Error("내부 tvmark 뷰어는 좌표 표시를 지원합니다. commands, interactive, 사용자 font, 출력 파일 설정을 비워 주세요.")
  }
  const coords = manifest.rows.find(row => row.id === manifest.inputs.coords?.[0])
  if (!coords) throw new Error("coords: 좌표 파일을 선택해 주세요.")
  return coords
}

export function tvmarkSource(coordsId: string, job: Job): Frame | undefined {
  if (!job.task?.endsWith(".daofind")) return
  const product = job.products.find(row => row.id === coordsId)
  if (!product) return
  const wcs = job.manifest?.parameters?.wcsout
  if (wcs && wcs !== "logical") throw new Error("daofind의 wcsout=logical 좌표가 필요합니다.")
  const source = product.source
  return job.manifest?.rows.find(row => row.id === source && row.asset === "image" && row.viewer_supported !== false)
}

export function parseTvmark(text: string, parameters: Values): ViewerMarker[] {
  const markers: ViewerMarker[] = []
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const fields = line.trim().split(/\s+/)
    const x = numeric(fields[0]), y = numeric(fields[1] || "NaN")
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`coords ${index + 1}행: x, y 좌표를 읽을 수 없습니다.`)
    markers.push({ x, y, label: yes(parameters.label) ? fields[2] || "" : yes(parameters.number) ? String(markers.length + 1) : "" })
  }
  return markers
}

export function tvmarkStyle(parameters: Values, radii = "0", lengths = "0"): MarkerAppearance {
  const shape = String(parameters.mark || "point") as MarkerAppearance["shape"]
  if (!["point", "circle", "rectangle", "line", "plus", "cross", "none"].includes(shape)) throw new Error("mark: 지원하지 않는 표시 모양입니다.")
  const lengthFields = lengths.trim().split(/\s+/)
  const sizes = (shape === "rectangle" ? lengthFields[0] : radii).trim().split(/[,\s]+/).map(numeric)
  const ratio = lengthFields[1] ? numeric(lengthFields[1]) : 1
  if (sizes.some(v => !Number.isFinite(v) || v < 0) || !Number.isFinite(ratio) || ratio <= 0) throw new Error("radii / lengths: 크기와 비율을 확인해 주세요.")
  const color = Number(parameters.color ?? 255)
  const pointSize = Math.max(1, Math.ceil(Number(parameters.pointsize ?? 3)))
  return {
    shape, sizes, ratio,
    color: tvmarkColors.find(option => Number(option.value) === color)?.color || `rgb(${color}, ${color}, ${color})`,
    pointSize: pointSize % 2 ? pointSize : pointSize + 1,
    textSize: Math.max(1, Number(parameters.txsize ?? 1)),
    offsetX: Number(parameters.nxoffset ?? 0), offsetY: Number(parameters.nyoffset ?? 0),
  }
}

export type TvmarkSession = { coords: Frame; markers: ViewerMarker[]; frame?: Frame }
