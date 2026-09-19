import { useEffect } from "react"
import { useStore, useStoreApi, type Handle } from "@xyflow/react"
import { clickConnectionPreview } from "@/lib/click-connection"

/**
 * React Flow 12 tracks click connections separately from its live connection line.
 * Bridge pointer position into the native connection state: the standard renderer,
 * validation, Handle classes and useConnection consumers then work for both modes.
 * Store access is isolated here because no public instance action starts a preview.
 */
export function WorkflowClickConnection() {
  const start = useStore((state) => state.connectionClickStartHandle)
  const store = useStoreApi()
  useEffect(() => {
    if (!start) return
    const root = store.getState().domNode
    if (!root) return
    let frame = 0
    let pointer: { clientX: number; clientY: number } | null = null
    const handleElement = (nodeId: string, id: string | null, type: string) =>
      [...root.querySelectorAll<HTMLElement>(".react-flow__handle")].find(
        (el) =>
          el.dataset.nodeid === nodeId &&
          (el.dataset.handleid || null) === id &&
          el.classList.contains(type)
      )
    const cancel = () => {
      store.setState({ connectionClickStartHandle: null })
      store.getState().cancelConnection()
    }
    function update() {
      frame = 0
      const state = store.getState()
      if (!state.connectionClickStartHandle) return
      const fromNode = state.nodeLookup.get(start!.nodeId)
      const fromBounds = fromNode?.internals.handleBounds?.[start!.type]?.find(
        (h) => (h.id || null) === start!.id
      )
      const origin = handleElement(
        start!.nodeId,
        start!.id ?? null,
        start!.type
      )
      if (!fromNode || fromNode.hidden || !fromBounds || !origin) {
        cancel()
        return
      }
      const rect = root!.getBoundingClientRect()
      const originRect = origin.getBoundingClientRect()
      const point = pointer ?? {
        clientX: originRect.right + 40,
        clientY: originRect.top + originRect.height / 2,
      }
      const hit = document.elementFromPoint(point.clientX, point.clientY)
      let target = hit?.closest<HTMLElement>(".react-flow__handle") ?? null
      // The labeled input row is the same target as its small port.
      const row = hit?.closest<HTMLElement>("[data-input-role]")
      const nodeId = row?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId
      if (!target && row && nodeId)
        target = handleElement(nodeId, row.dataset.inputRole!, "target") ?? null
      if (!target) {
        let distance = state.connectionRadius
        for (const el of root!.querySelectorAll<HTMLElement>(
          ".react-flow__handle"
        )) {
          if (el === origin || !el.classList.contains("connectable")) continue
          const r = el.getBoundingClientRect()
          const d = Math.hypot(
            point.clientX - r.left - r.width / 2,
            point.clientY - r.top - r.height / 2
          )
          if (d < distance) {
            target = el
            distance = d
          }
        }
      }
      const toNode = target
        ? state.nodeLookup.get(target.dataset.nodeid!)
        : undefined
      const targetType = target?.classList.contains("source")
        ? "source"
        : "target"
      const bounds = toNode?.internals.handleBounds?.[targetType]?.find(
        (h) => (h.id || null) === (target?.dataset.handleid || null)
      )
      const toHandle: Handle | undefined =
        toNode && bounds
          ? { ...bounds, nodeId: toNode.id, type: targetType }
          : undefined
      const fromHandle: Handle = {
        ...fromBounds,
        nodeId: fromNode.id,
        type: start!.type,
      }
      const connection =
        start!.type === "source"
          ? {
              source: fromNode.id,
              sourceHandle: start!.id ?? null,
              target: toNode?.id ?? "",
              targetHandle: toHandle?.id ?? null,
            }
          : {
              source: toNode?.id ?? "",
              sourceHandle: toHandle?.id ?? null,
              target: fromNode.id,
              targetHandle: start!.id ?? null,
            }
      const valid =
        !!target &&
        target.classList.contains("connectable") &&
        targetType !== start!.type &&
        !!state.isValidConnection?.(connection)
      state.updateConnection(
        clickConnectionPreview({
          fromNode,
          fromHandle,
          toNode,
          toHandle,
          pointer: {
            x: point.clientX - rect.left,
            y: point.clientY - rect.top,
          },
          transform: state.transform,
          isValid: valid,
        })
      )
    }
    const move = (event: PointerEvent) => {
      pointer = { clientX: event.clientX, clientY: event.clientY }
      if (!frame) frame = requestAnimationFrame(update)
    }
    const focus = (event: FocusEvent) => {
      const el = event.target as HTMLElement
      if (!el.closest(".react-flow__handle, [data-input-role]")) return
      const rect = el.getBoundingClientRect()
      pointer = {
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
      }
      update()
    }
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") cancel()
    }
    const down = (event: PointerEvent) => {
      const el = event.target as Element
      if (!root.contains(el) || el.classList.contains("react-flow__pane"))
        cancel()
    }
    const leave = () => store.getState().cancelConnection()
    const unsubscribe = store.subscribe((state, previous) => {
      if (!state.connectionClickStartHandle) return
      const node = state.nodeLookup.get(start.nodeId)
      if (!node || node.hidden) {
        cancel()
        return
      }
      if (state.transform !== previous.transform && !frame)
        frame = requestAnimationFrame(update)
    })
    update()
    root.addEventListener("pointermove", move)
    root.addEventListener("pointerleave", leave)
    root.addEventListener("focusin", focus)
    document.addEventListener("keydown", key)
    document.addEventListener("pointerdown", down)
    return () => {
      cancelAnimationFrame(frame)
      unsubscribe()
      root.removeEventListener("pointermove", move)
      root.removeEventListener("pointerleave", leave)
      root.removeEventListener("focusin", focus)
      document.removeEventListener("keydown", key)
      document.removeEventListener("pointerdown", down)
      store.getState().cancelConnection()
    }
  }, [start, store])
  return null
}
