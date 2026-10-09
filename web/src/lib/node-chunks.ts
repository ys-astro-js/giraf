import type { Spec } from "./workbench"

type Run = NonNullable<Spec["run"]>

export type NodeChunk = {
  id: "files" | "flow" | "values"
  label: string
  nodes: Spec[]
}

/** GIRAF's own nodes, by what they do; a chunk orders its nodes as listed. */
const CHUNKS: { id: NodeChunk["id"]; label: string; runs: Run[] }[] = [
  { id: "files", label: "파일", runs: ["pass-files", "save-files"] },
  { id: "flow", label: "흐름", runs: ["foreach", "for", "if"] },
  {
    id: "values",
    label: "값",
    runs: ["value-constant", "value-header", "value-compute"],
  },
]

/** Splits GIRAF nodes into chunks by `run`; a node no chunk names joins the last one. */
export function nodeChunks(nodes: Spec[]): NodeChunk[] {
  const rank = (chunk: (typeof CHUNKS)[number], node: Spec) => {
    const index = chunk.runs.indexOf(node.run as Run)
    return index < 0 ? chunk.runs.length : index
  }
  const last = CHUNKS.at(-1)!
  return CHUNKS.map((chunk) => ({
    id: chunk.id,
    label: chunk.label,
    nodes: nodes
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
