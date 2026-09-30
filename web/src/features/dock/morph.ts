import { flushSync } from "react-dom"
import type { DockviewGroupPanel, IDockviewPanel } from "dockview-react"

/**
 * Switching tabs morphs the window's bars instead of swapping them: each tab
 * draws its own toolbar, so the capsules before and after are paired up
 * (the top bar's from its trailing end, the bottom bar's from its leading
 * end) and a view transition carries each box to its new size and place.
 * A lone button can grow into a group this way, and back.
 */

const TOP =
  ".window-toolbar-slot .toolbar-slot:not([data-hidden='true']) > .toolbar-group"
const BOTTOM =
  ".window-bottom-bar .window-toolbar-cluster > :not(.toolbar-spacer, .toolbar-slot[data-hidden='true'])"

function visible(root: Element, selector: string) {
  return [...root.querySelectorAll<HTMLElement>(selector)].filter(
    (element) => element.getBoundingClientRect().width > 0
  )
}

function name(element: HTMLElement, value: string, kind: string) {
  element.style.setProperty("view-transition-name", value)
  element.style.setProperty("view-transition-class", kind)
  element.dataset.windowMorph = ""
}

function clearNames() {
  for (const element of document.querySelectorAll<HTMLElement>(
    "[data-window-morph]"
  )) {
    element.style.removeProperty("view-transition-name")
    element.style.removeProperty("view-transition-class")
    delete element.dataset.windowMorph
  }
}

/** Names what the window's bars show now, so a transition can pair it up. */
function nameBars(group: DockviewGroupPanel) {
  clearNames()
  const id = `window-${group.id.replace(/\W/g, "")}`
  const root = group.element
  const title = root.querySelector<HTMLElement>(".window-title")
  if (title) name(title, `${id}-title`, "window-title")
  visible(root, TOP)
    .sort(
      (a, b) =>
        b.getBoundingClientRect().right - a.getBoundingClientRect().right
    )
    .forEach((element, index) =>
      name(element, `${id}-top-${index}`, "window-top")
    )
  visible(root, BOTTOM)
    .sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left
    )
    .forEach((element, index) =>
      name(element, `${id}-bottom-${index}`, "window-bottom")
    )
}

/** Shows a tab, morphing its window's bars from the tab shown before. */
export function switchTab(panel: IDockviewPanel) {
  const group = panel.group
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  if (!document.startViewTransition || reduced) {
    panel.api.setActive()
    return
  }
  nameBars(group)
  const transition = document.startViewTransition(() => {
    flushSync(() => panel.api.setActive())
    nameBars(group)
  })
  transition.finished.finally(clearNames)
}
