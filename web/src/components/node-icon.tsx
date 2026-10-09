import {
  Calculator,
  FileInput,
  FileSearch,
  FolderDown,
  ListOrdered,
  Repeat,
  SlidersHorizontal,
  Split,
  Terminal,
  Variable,
} from "lucide-react"
import { VALUE_ICON, VALUE_MODES } from "@/lib/value-modes"

/** The node schema's `icon` symbols for GIRAF's own nodes. */
const NODE_ICONS: Record<string, typeof Terminal> = {
  "file-input": FileInput,
  "folder-down": FolderDown,
  variable: Variable,
  "file-search": FileSearch,
  calculator: Calculator,
  repeat: Repeat,
  "list-ordered": ListOrdered,
  split: Split,
  "sliders-horizontal": SlidersHorizontal,
}
/** A node's icon by its schema `icon`; every 값 node, whatever its 가져오기, shows the 값 icon. */
export const NodeIcon = ({ icon, run }: { icon?: string; run?: string }) => {
  const name = VALUE_MODES.some((mode) => mode.run === run) ? VALUE_ICON : icon
  const Icon = (name && NODE_ICONS[name]) || Terminal
  return <Icon aria-hidden="true" />
}
