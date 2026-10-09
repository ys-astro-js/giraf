import type { Spec } from "./workbench"
import { VALUE_MODES } from "./value-modes"

type Run = NonNullable<Spec["run"]>

export type NodeChunk = {
  id: "files" | "script"
  label: string
  nodes: Spec[]
}

/**
 * The 값 node's other 가져오기 runs: reached from its inspector, not tiles
 * of their own. Search still finds them (TaskPopover).
 */
const MODE_RUNS = new Set<string>(VALUE_MODES.slice(1).map((mode) => mode.run))
export const isModeOnly = (node: Spec) => MODE_RUNS.has(node.run ?? "")

/** GIRAF's own nodes, by what they do; a chunk orders its nodes as listed. */
const CHUNKS: { id: NodeChunk["id"]; label: string; runs: Run[] }[] = [
  { id: "files", label: "파일", runs: ["pass-files", "save-files"] },
  {
    id: "script",
    label: "스크립트하기",
    runs: ["foreach", VALUE_MODES[0].run],
  },
]

/**
 * Splits GIRAF nodes into chunks by `run`; a node no chunk names joins the
 * last one, and the 값 node's other runs show in none.
 */
export function nodeChunks(nodes: Spec[]): NodeChunk[] {
  const rank = (chunk: (typeof CHUNKS)[number], node: Spec) => {
    const index = chunk.runs.indexOf(node.run as Run)
    return index < 0 ? chunk.runs.length : index
  }
  const last = CHUNKS.at(-1)!
  const tiles = nodes.filter((node) => !isModeOnly(node))
  return CHUNKS.map((chunk) => ({
    id: chunk.id,
    label: chunk.label,
    nodes: tiles
      .filter(
        (node) =>
          chunk.runs.includes(node.run as Run) ||
          (chunk === last &&
            !CHUNKS.some((c) => c.runs.includes(node.run as Run)))
      )
      // Stable: unknown nodes keep their catalog order after the known ones.
      .sort((a, b) => rank(chunk, a) - rank(chunk, b)),
  })).filter((chunk) => chunk.nodes.length)
}
