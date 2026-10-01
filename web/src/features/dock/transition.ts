import type { DockviewApi, DockviewGroupPanel } from "dockview-react"
import { afterRender, EASE, reducedMotion, SHIFT } from "./motion"

/*
 * A layout change (a window docked, split, merged, shown, hidden or
 * maximized) moves windows to new boxes in one step. Instead of jumping,
 * each moved window's frame travels from its old box to its new one
 * beneath the windows, its title riding along, and the window itself,
 * already laid out at its new size, opens out from what its old box
 * covered: a growing window unfolds over the space it takes, a shrinking
 * one shows at once while its frame closes in on it. A window whose tabs
 * went into another is drawn into that window; a closed one fades where it
 * was; a new one grows in place. Splitter drags and the browser resizing
 * are the user's own hand and are never animated.
 */

type Box = { left: number; top: number; width: number; height: number }

/** How a window looked at one moment, for its stand-in frame. */
type Frame = {
  group: DockviewGroupPanel
  /** What a moved window is shown by: its floating box, or the group. */
  element: HTMLElement
  box: Box
  panels: string[]
  /** The tab it shows, which a moved window brings along. */
  active?: string
  title: string
  background: string
  radius: string
  shadow: string
}

/** Contents with no box in common fade in from this share of the shift. */
const REVEAL_AT = 0.6
const REVEAL = 180
const LEAVE = 200

function frames(dock: DockviewApi, origin: DOMRect) {
  const result = new Map<string, Frame>()
  for (const group of dock.groups) {
    const floating = group.element.closest<HTMLElement>(".dv-resize-container")
    const element = floating ?? group.element
    if (floating?.hidden) continue
    const rect = element.getBoundingClientRect()
    if (rect.width < 2 || rect.height < 2) continue
    const content = group.element.querySelector<HTMLElement>(
      ".dv-content-container .dock-window"
    )
    const style = getComputedStyle(element)
    result.set(group.id, {
      group,
      element,
      box: {
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      },
      panels: group.panels.map((panel) => panel.id),
      active: group.activePanel?.id,
      title: group.activePanel?.title ?? "",
      background: content
        ? getComputedStyle(content).backgroundColor
        : style.backgroundColor,
      radius: style.borderRadius,
      shadow: style.boxShadow,
    })
  }
  return result
}

const same = (a: Box, b: Box) =>
  Math.abs(a.left - b.left) < 1 &&
  Math.abs(a.top - b.top) < 1 &&
  Math.abs(a.width - b.width) < 1 &&
  Math.abs(a.height - b.height) < 1

/**
 * The frame a window had before: that of the window its shown tab came
 * from (a dropped window filling a slot or joining another), else its own,
 * else that of any window its tabs came from.
 */
function previous(frame: Frame, before: Map<string, Frame>) {
  for (const old of before.values())
    if (frame.active && old.panels.includes(frame.active)) return old
  const own = before.get(frame.group.id)
  if (own) return own
  for (const old of before.values())
    if (frame.panels.some((id) => old.panels.includes(id))) return old
}

/** Where a window that is gone went: the window now holding its tabs. */
function next(frame: Frame, after: Map<string, Frame>) {
  for (const now of after.values())
    if (frame.panels.some((id) => now.panels.includes(id))) return now
}

const place = (box: Box) => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
})

/**
 * The part of a window's new box that its old box covered, as a clip of
 * the new box; none when the two do not meet.
 */
function clipFrom(old: Box, frame: Pick<Frame, "box" | "radius">) {
  const box = frame.box
  const top = Math.max(0, old.top - box.top)
  const left = Math.max(0, old.left - box.left)
  const right = Math.max(0, box.left + box.width - (old.left + old.width))
  const bottom = Math.max(0, box.top + box.height - (old.top + old.height))
  if (left + right >= box.width || top + bottom >= box.height) return
  return `inset(${top}px ${right}px ${bottom}px ${left}px round ${frame.radius})`
}

const fullClip = (radius: string) => `inset(0px 0px 0px 0px round ${radius})`

function stand(frame: Frame) {
  const element = document.createElement("div")
  element.className = "window-transition-frame"
  Object.assign(element.style, place(frame.box), {
    background: frame.background,
    borderRadius: frame.radius,
    boxShadow: frame.shadow,
  })
  const title = document.createElement("span")
  title.className = "window-transition-title"
  title.textContent = frame.title
  element.append(title)
  return element
}

let finishRunning: (() => void) | undefined
let depth = 0

/** Makes a layout change without animating it (loading, presets). */
export function quietly(change: () => void) {
  depth++
  try {
    change()
  } finally {
    depth--
  }
}

/**
 * Makes a layout change and animates the windows it moved. Nested calls
 * (one change made of others) animate once, as a whole.
 */
export function animateLayout(
  dock: DockviewApi | undefined,
  change: () => void
) {
  if (!dock || depth > 0) {
    change()
    return
  }
  finishRunning?.()
  const root = document.querySelector<HTMLElement>(".dock-root")
  if (!root) {
    change()
    return
  }
  const origin = root.getBoundingClientRect()
  const before = frames(dock, origin)
  depth++
  try {
    change()
  } finally {
    depth--
  }
  // Measured at once, the new layout decides which windows moved; they hide
  // before the next paint, so nothing is ever seen jumping.
  const now = frames(dock, root.getBoundingClientRect())
  const moved = [...now.values()].filter((frame) => {
    const old = previous(frame, before)
    return !old || !same(old.box, frame.box)
  })
  // A window dockview rebuilt as a new group travels as that group.
  const rebuilt = new Set(moved.map((frame) => previous(frame, before)))
  const gone = [...before.values()].filter(
    (frame) => !now.has(frame.group.id) && !rebuilt.has(frame)
  )
  if (!moved.length && !gone.length) return

  if (reducedMotion()) {
    for (const frame of moved)
      frame.element.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: 150,
        easing: "ease-out",
      })
    return
  }

  // Old frames lie beneath the windows; each moved window, already laid
  // out in its new box, shows only the part its old box covered, so before
  // the next paint everything still looks where it was.
  const layer = document.createElement("div")
  layer.className = "window-transition-layer"
  layer.inert = true
  const traveling = new Map<Frame, HTMLElement>()
  for (const frame of moved) {
    const old = previous(frame, before)
    const clip = old && clipFrom(old.box, frame)
    if (old) traveling.set(frame, stand(old))
    if (clip) frame.element.style.clipPath = clip
    else frame.element.dataset.layoutMoving = ""
  }
  const leaving = new Map(gone.map((frame) => [frame, stand(frame)]))
  layer.append(...traveling.values(), ...leaving.values())
  root.append(layer)

  const animations: Animation[] = []
  let done = false
  const release = () => {
    for (const frame of moved) {
      frame.element.style.clipPath = ""
      delete frame.element.dataset.layoutMoving
    }
  }
  const finish = () => {
    if (done) return
    done = true
    for (const animation of animations) animation.cancel()
    release()
    layer.remove()
    if (finishRunning === finish) finishRunning = undefined
  }
  finishRunning = finish

  // Some changes settle a frame later (a maximized window takes the app's
  // bar), so everything travels to the boxes as they finally are.
  afterRender(() => {
    if (done) return
    const after = frames(dock, root.getBoundingClientRect())
    let end = 0
    const animate = (
      element: Element,
      keyframes: Keyframe[],
      options: KeyframeAnimationOptions
    ) => {
      animations.push(element.animate(keyframes, { fill: "both", ...options }))
      end = Math.max(
        end,
        Number(options.delay ?? 0) + Number(options.duration ?? 0)
      )
    }
    for (const frame of moved) {
      const target = after.get(frame.group.id) ?? frame
      const old = previous(frame, before)
      const plate = traveling.get(frame)
      if (!old || !plate) {
        // A new window grows in place.
        animate(
          frame.element,
          [
            { opacity: 0, transform: "scale(0.97)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: SHIFT, easing: EASE }
        )
        continue
      }
      animate(
        plate,
        [
          { ...place(old.box), borderRadius: old.radius },
          { ...place(target.box), borderRadius: target.radius },
        ],
        { duration: SHIFT, easing: EASE }
      )
      // Its contents open out from what the old box covered, or, with
      // nothing in common, fade in as the frame arrives.
      const clip = clipFrom(old.box, target)
      if (clip)
        animate(
          frame.element,
          [{ clipPath: clip }, { clipPath: fullClip(target.radius) }],
          { duration: SHIFT, easing: EASE }
        )
      else
        animate(frame.element, [{ opacity: 0 }, { opacity: 1 }], {
          delay: SHIFT * REVEAL_AT,
          duration: REVEAL,
          easing: "ease-out",
        })
    }
    for (const [frame, element] of leaving) {
      const into = next(frame, after)
      // Tabs that joined another window are drawn into it; a closed or
      // minimized window fades where it was.
      animate(
        element,
        into
          ? [
              { ...place(frame.box), opacity: 1 },
              { ...place(into.box), opacity: 0 },
            ]
          : [
              { opacity: 1, transform: "none" },
              { opacity: 0, transform: "scale(0.97)" },
            ],
        { duration: into ? SHIFT : LEAVE, easing: into ? EASE : "ease-in" }
      )
    }
    // The animations hold the first states from here on.
    release()
    window.setTimeout(finish, end + 30)
  })
}
