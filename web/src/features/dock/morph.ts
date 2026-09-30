import type { DockviewGroupPanel } from "dockview-react"

/**
 * Switching tabs morphs a window's bars capsule by capsule. Each tab brings
 * its own controls, so while the switch plays the window hides the real
 * capsules and moves stand-ins, each carrying the old and the new contents,
 * from the old layout to the new one; the real capsules take over where the
 * stand-ins land. Search fields and buttons are capsules alike.
 *
 * A section is anchored at its outer end, and its capsules pair up from
 * there: the top bar's trailing section and the bottom bar's trailing half
 * from the right, the leading controls and the bottom bar's leading half
 * from the left. An old capsule with no partner is absorbed into its
 * neighbor toward the anchor, paired capsules resize while their contents
 * cross-fade, and a new capsule with no partner splits out of that
 * neighbor, as one overlapping cascade in that order. With no neighbor at
 * all, capsules materialize (blur in or out). The title does not travel; it
 * cross-fades in place (see dock.css). Motion uses the toolbar's own timing.
 */

/** The toolbar's shift (see toolbar.css --motion-shift, --motion-ease). */
const SHIFT = 380
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
/** How far each step of the cascade trails the one before. */
const STAGGER = 0.35 * SHIFT
/** How long a recorded bar stays good for the switch that follows it. */
const FRESH = 1000

type Anchor = "left" | "right"
type Box = { left: number; top: number; width: number; height: number }
type Capsule = { element: HTMLElement; box: Box; face: HTMLElement }
type Section = { anchor: Anchor; capsules: Capsule[] }
type Bars = Record<"top" | "leading" | "start" | "end", Section>
/** The bottom bar's own band, drawn only while it holds controls. */
type Band = { box: Box; background: string; filter: string }

const visibleGroups = (root: Element | null) =>
  root
    ? [
        ...root.querySelectorAll<HTMLElement>(
          ".toolbar-slot:not([data-hidden='true']) > .toolbar-group"
        ),
      ]
    : []

/** A capsule's contents, drawn without its capsule, held to one end. */
function face(element: HTMLElement, box: Box, anchor: Anchor) {
  const copy = element.cloneNode(true) as HTMLElement
  copy.classList.add("window-morph-face")
  copy.removeAttribute("data-morph-hidden")
  copy.style.width = `${box.width}px`
  copy.style.height = `${box.height}px`
  copy.style.setProperty(anchor, "-1px")
  return copy
}

function measure(
  elements: HTMLElement[],
  origin: DOMRect,
  anchor: Anchor
): Section {
  const capsules = elements
    .map((element) => {
      const rect = element.getBoundingClientRect()
      const box = {
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      }
      return { element, box, face: face(element, box, anchor) }
    })
    .filter((capsule) => capsule.box.width > 1)
    .sort((a, b) =>
      anchor === "right" ? b.box.left - a.box.left : a.box.left - b.box.left
    )
  return { anchor, capsules }
}

/** Everything a window's bars show now, in the window's coordinates. */
function bars(group: DockviewGroupPanel): Bars {
  const root = group.element
  const origin = root.getBoundingClientRect()
  const top = root.querySelector(
    ".window-toolbar-slot:not(.window-leading-slot)"
  )
  const leading = root.querySelector(".window-leading-slot")
  const bottom = root.querySelector<HTMLElement>(".window-bottom-bar")
  // The bottom bar's controls split at its middle into two sections.
  const lower = bottom
    ? [
        ...visibleGroups(bottom),
        ...bottom.querySelectorAll<HTMLElement>(
          ".window-toolbar-cluster > :is(.search-field, button)"
        ),
      ]
    : []
  const middle = bottom
    ? (() => {
        const rect = bottom.getBoundingClientRect()
        return rect.left + rect.width / 2
      })()
    : 0
  const center = (element: HTMLElement) => {
    const rect = element.getBoundingClientRect()
    return rect.left + rect.width / 2
  }
  return {
    top: measure(visibleGroups(top), origin, "right"),
    leading: measure(visibleGroups(leading), origin, "left"),
    start: measure(
      lower.filter((element) => center(element) < middle),
      origin,
      "left"
    ),
    end: measure(
      lower.filter((element) => center(element) >= middle),
      origin,
      "right"
    ),
  }
}

function band(group: DockviewGroupPanel): Band | null {
  const element = group.element.querySelector<HTMLElement>(".window-bottom-bar")
  const rect = element?.getBoundingClientRect()
  if (!element || !rect?.width) return null
  const origin = group.element.getBoundingClientRect()
  const style = getComputedStyle(element)
  return {
    box: {
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      width: rect.width,
      height: rect.height,
    },
    background: style.backgroundColor,
    filter: style.backdropFilter,
  }
}

/** Where every capsule sits, to tell when the new layout has settled. */
const layout = (bars: Bars) =>
  Object.values(bars)
    .flatMap((section) => section.capsules)
    .map(({ box }) => `${box.left},${box.top},${box.width}`)
    .join(" ")

const recorded = new WeakMap<
  DockviewGroupPanel,
  { at: number; bars: Bars; band: Band | null }
>()

/**
 * Records a window's bars just before its shown tab may change. The bottom
 * bar belongs to the tab, which leaves the page as the switch begins, so it
 * has to be caught beforehand: on a tab press, or before code shows a tab.
 */
export function recordBars(group: DockviewGroupPanel) {
  recorded.set(group, {
    at: performance.now(),
    bars: bars(group),
    band: band(group),
  })
}

const place = (box: Box) => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
})

/** A capsule tucked behind a neighbor's edge that faces the anchor's way. */
const tucked = (neighbor: Box, own: Box, anchor: Anchor): Box => {
  const width = Math.min(own.height, own.width)
  return {
    ...own,
    left:
      anchor === "right"
        ? neighbor.left
        : neighbor.left + neighbor.width - width,
    width,
  }
}

function stand(box: Box) {
  const element = document.createElement("div")
  element.className = "window-morph-capsule"
  Object.assign(element.style, place(box))
  return element
}

/**
 * Runs once the new tab's controls have rendered: after two frames, or a
 * short timer when frames are not coming (a hidden window).
 */
function afterRender(run: () => void) {
  let ran = false
  const once = () => {
    if (ran) return
    ran = true
    run()
  }
  requestAnimationFrame(() => requestAnimationFrame(once))
  window.setTimeout(once, 50)
}

const running = new WeakMap<HTMLElement, () => void>()

/**
 * Call when a window's shown tab changes, before the new tab's controls
 * render: it takes the bars as recorded (or as they still are) and plays
 * the morph once the new controls are in place.
 */
export function morphBars(group: DockviewGroupPanel) {
  const root = group.element
  running.get(root)?.()
  const record = recorded.get(group)
  recorded.delete(group)
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const now = bars(group)
  const fresh = record && performance.now() - record.at < FRESH
  // The top bar is still on the page; the bottom bar only in the record.
  const before: Bars = {
    top: now.top,
    leading: now.leading,
    start: fresh ? record.bars.start : { anchor: "left", capsules: [] },
    end: fresh ? record.bars.end : { anchor: "right", capsules: [] },
  }

  const oldBand = fresh ? record.band : null

  const layer = document.createElement("div")
  layer.className = "window-morph-layer"
  layer.inert = true
  const bandStand = (source: Band) => {
    const element = document.createElement("div")
    element.className = "window-morph-band"
    Object.assign(element.style, place(source.box), {
      background: source.background,
      backdropFilter: source.filter,
    })
    return element
  }
  // Until the new controls are measured, the old ones stay drawn as they were.
  if (oldBand) layer.append(bandStand(oldBand))
  for (const section of Object.values(before))
    for (const capsule of section.capsules) {
      const element = stand(capsule.box)
      element.append(capsule.face.cloneNode(true))
      layer.append(element)
    }
  root.dataset.morphing = ""
  root.append(layer)

  const animations: Animation[] = []
  let done = false
  const finish = () => {
    if (done) return
    done = true
    // The real capsules show as they are, without transitions, then settle.
    root.dataset.settling = ""
    delete root.dataset.morphing
    layer.remove()
    for (const animation of animations) animation.cancel()
    running.delete(root)
    afterRender(() => delete root.dataset.settling)
  }
  running.set(root, finish)

  // Wait for the new layout to hold still (an overflow menu may still fold
  // groups away a frame later), up to a few frames.
  let settled = ""
  let tries = 0
  const settle = () =>
    afterRender(() => {
      if (done) return
      const next = layout(bars(group))
      if (next !== settled && tries++ < 5) {
        settled = next
        return settle()
      }
      play()
    })
  settle()

  const play = () => {
    const after = bars(group)
    const newBand = band(group)
    const below: HTMLElement[] = []
    const above: HTMLElement[] = []
    let end = 0

    const animate = (
      element: Element,
      frames: Keyframe[],
      delay: number,
      duration = SHIFT,
      easing = EASE
    ) => {
      animations.push(
        element.animate(frames, { delay, duration, easing, fill: "both" })
      )
      end = Math.max(end, delay + duration)
    }
    const fade = (element: Element, into: boolean, at: number, blur = 4) =>
      animate(
        element,
        into
          ? [
              { opacity: 0, filter: `blur(${blur}px)` },
              { opacity: 1, filter: "blur(0)" },
            ]
          : [
              { opacity: 1, filter: "blur(0)" },
              { opacity: 0, filter: `blur(${blur}px)` },
            ],
        at,
        into ? 260 : 200,
        into ? "ease-out" : "ease-in"
      )
    /** Contents leave toward the section's anchor and come from there. */
    const crossFade = (
      out: Element | null,
      into: Element,
      at: number,
      anchor: Anchor
    ) => {
      const away = `translateX(${anchor === "right" ? 12 : -12}px)`
      if (out)
        animate(
          out,
          [
            { opacity: 1, filter: "blur(0)", transform: "none" },
            { opacity: 0, filter: "blur(4px)", transform: away },
          ],
          at,
          200,
          "ease-out"
        )
      animate(
        into,
        [
          { opacity: 0, filter: "blur(4px)", transform: away },
          { opacity: 1, filter: "blur(0)", transform: "none" },
        ],
        at + 60,
        260,
        "ease-out"
      )
    }

    for (const key of ["top", "leading", "start", "end"] as const) {
      const { anchor } = after[key]
      const old = before[key].capsules
      const next = after[key].capsules
      const paired = Math.min(old.length, next.length)
      const resizeAt = old.length > paired && paired ? STAGGER : 0
      const splitAt = resizeAt + (paired ? STAGGER : 0)

      // Absorb: old capsules without a partner slide into their neighbor.
      old.forEach((capsule, index) => {
        if (index < paired) return
        const element = stand(capsule.box)
        element.append(capsule.face.cloneNode(true))
        below.push(element)
        if (!paired) return fade(element, false, 0, 8)
        const neighbor = old[paired - 1].box
        animate(
          element,
          [place(capsule.box), place(tucked(neighbor, capsule.box, anchor))],
          0
        )
        fade(element, false, 0)
      })
      // Resize: paired capsules travel and resize, contents cross-fading.
      for (let index = 0; index < paired; index++) {
        const element = stand(old[index].box)
        const out = old[index].face.cloneNode(true) as HTMLElement
        const into = next[index].face
        element.append(out, into)
        above.push(element)
        animate(
          element,
          [place(old[index].box), place(next[index].box)],
          resizeAt
        )
        crossFade(out, into, resizeAt, anchor)
      }
      // Split: new capsules without a partner come out of their neighbor.
      next.forEach((capsule, index) => {
        if (index < paired) return
        const element = stand(capsule.box)
        element.append(capsule.face)
        below.push(element)
        if (!paired) return fade(element, true, 0, 8)
        const neighbor = next[paired - 1].box
        animate(
          element,
          [place(tucked(neighbor, capsule.box, anchor)), place(capsule.box)],
          splitAt
        )
        fade(element, true, splitAt)
        crossFade(null, capsule.face, splitAt, anchor)
      })
    }
    // The bottom bar's band comes and goes with its controls.
    const bands: HTMLElement[] = []
    if (oldBand && newBand) bands.push(bandStand(newBand))
    else if (oldBand) {
      const element = bandStand(oldBand)
      fade(element, false, 0, 8)
      bands.push(element)
    } else if (newBand) {
      const element = bandStand(newBand)
      fade(element, true, 0, 8)
      bands.push(element)
    }
    // Capsules that tuck away or come out pass behind their neighbors.
    layer.replaceChildren(...bands, ...below, ...above)
    window.setTimeout(finish, end + 30)
  }
}
