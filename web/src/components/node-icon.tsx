import {
  Calculator,
  FileInput,
  FileSearch,
  FolderDown,
  ListOrdered,
  Repeat,
  Split,
  Terminal,
  Variable,
} from "lucide-react"

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
}
export const NodeIcon = ({ icon }: { icon?: string }) => {
  const Icon = (icon && NODE_ICONS[icon]) || Terminal
  return <Icon aria-hidden="true" />
}
