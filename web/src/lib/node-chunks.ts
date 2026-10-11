import type { Spec } from "./workbench"
import { VALUE_MODES } from "./value-modes"

/**
 * The 값 node's other 가져오기 runs: reached from its inspector, not tiles
 * of their own. Search still finds them (TaskPopover).
 */
const MODE_RUNS = new Set<string>(VALUE_MODES.slice(1).map((mode) => mode.run))
export const isModeOnly = (node: Spec) => MODE_RUNS.has(node.run ?? "")

/** The tile order of GIRAF's own nodes by `run`: files in, files out, values. */
const ORDER: string[] = ["pass-files", "save-files", VALUE_MODES[0].run]

/**
 * GIRAF's own nodes as the add popover's one row of tiles, in a fixed order
 * by `run`; a node the order does not name follows in catalog order, and the
 * 값 node's other runs have no tile.
 */
export function nodeTiles(nodes: Spec[]): Spec[] {
  const rank = (node: Spec) => {
    const index = ORDER.indexOf(node.run ?? "")
    return index < 0 ? ORDER.length : index
  }
  // Stable: unknown nodes keep their catalog order after the known ones.
  return nodes.filter((node) => !isModeOnly(node)).sort((a, b) => rank(a) - rank(b))
}
