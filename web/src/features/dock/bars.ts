import { create } from "zustand"
import type { OverflowRegistry } from "@/components/toolbar-context"

/** Each window's top bar overflow, by group id, for its tabs' toolbars. */
export const useBarOverflow = create<Record<string, OverflowRegistry>>()(
  () => ({})
)
