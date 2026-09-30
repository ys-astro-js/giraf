/**
 * Switching tabs morphs a window's top bar capsule by capsule. Each tab
 * brings its own toolbar, so while the switch plays the bar hides its real
 * capsules and moves stand-ins, each carrying the old and the new contents,
 * from the old layout to the new one; the real capsules take over where the
 * stand-ins land.
 *
 * The trailing section is anchored at its end: capsules pair up from the
 * right. An old capsule with no partner is absorbed into its right-hand
 * neighbor, paired capsules resize (a lone button grows into a group) while
 * their contents cross-fade, and a new capsule with no partner splits out of
 * its neighbor. These overlap as one cascade, in that order. Where there is
 * no neighbor at all, capsules materialize (blur in or out). Motion uses the
 * toolbar's own timing, so it reads like the rest of the toolbar.
 */

/** The toolbar's shift (see toolbar.css --motion-shift, --motion-ease). */
const SHIFT = 380
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
/** How far each step of the cascade trails the one before. */
const STAGGER = 0.35 * SHIFT
const CAPSULES =
  ".window-toolbar-slot:not(.window-leading-slot) .toolbar-slot:not([data-hidden='true']) > .toolbar-group"

type Box = { left: number; top: number; width: number; height: number }
type Capsule = { element: HTMLElement; box: Box }

/** Visible capsules of a bar, right to left, in the row's coordinates. */
function capsules(row: HTMLElement): Capsule[] {
  const origin = row.getBoundingClientRect()
  return [...row.querySelectorAll<HTMLElement>(CAPSULES)]
    .map((element) => {
      const rect = element.getBoundingClientRect()
      return {
        element,
        box: {
          left: rect.left - origin.left,
          top: rect.top - origin.top,
          width: rect.width,
          height: rect.height,
        },
      }
    })
    .filter((capsule) => capsule.box.width > 1)
    .sort((a, b) => b.box.left - a.box.left)
}

const place = (box: Box) => ({
  left: `${box.left}px`,
  top: `${box.top}px`,
  width: `${box.width}px`,
  height: `${box.height}px`,
})

/** A capsule tucked behind a neighbor's leading edge, as small as it gets. */
const tucked = (neighbor: Box, own: Box): Box => ({
  ...own,
  left: neighbor.left,
  width: Math.min(own.height, own.width),
})

/** A capsule's contents, drawn without the capsule, held to one end. */
function face(capsule: Capsule, end: "left" | "right") {
  const copy = capsule.element.cloneNode(true) as HTMLElement
  copy.classList.add("window-morph-face")
  copy.style.width = `${capsule.box.width}px`
  copy.style.height = `${capsule.box.height}px`
  copy.style.setProperty(end, "-1px")
  return copy
}

function stand(box: Box) {
  const element = document.createElement("div")
  element.className = "window-morph-capsule"
  Object.assign(element.style, place(box))
  return element
}

const running = new WeakMap<HTMLElement, () => void>()

/**
 * Runs once the new tab's toolbar has rendered: after two frames, or a short
 * timer when frames are not coming (a hidden window).
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

/**
 * Call when a window's shown tab is about to change, before the new tab's
 * toolbar renders: it records the bar as it is and plays the morph once the
 * new toolbar is in place.
 */
export function morphBar(row: HTMLElement) {
  running.get(row)?.()
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
  const before = capsules(row)
  const layer = document.createElement("div")
  layer.className = "window-morph-layer"
  layer.inert = true
  // Until the new toolbar is measured, the old one stays drawn as it was.
  layer.append(
    ...before.map((capsule) => {
      const element = stand(capsule.box)
      element.append(face(capsule, "right"))
      return element
    })
  )
  row.dataset.morphing = ""
  row.append(layer)

  const animations: Animation[] = []
  let done = false
  const finish = () => {
    if (done) return
    done = true
    // The real capsules show as they are, without transitions, then settle.
    row.dataset.settling = ""
    delete row.dataset.morphing
    layer.remove()
    for (const animation of animations) animation.cancel()
    running.delete(row)
    afterRender(() => delete row.dataset.settling)
  }
  running.set(row, finish)

  afterRender(() => {
    if (done) return
    const after = capsules(row)
    const paired = Math.min(before.length, after.length)
    const leaving = before.length > paired
    const resizeAt = leaving && paired ? STAGGER : 0
    const splitAt = resizeAt + (paired ? STAGGER : 0)
    let end = 0

    const play = (
      element: HTMLElement,
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
    const fade = (element: HTMLElement, into: boolean, at: number, blur = 4) =>
      play(
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
    /** Old contents leave toward the bar's end; new ones come from there. */
    const crossFade = (
      out: HTMLElement | null,
      into: HTMLElement,
      at: number
    ) => {
      if (out)
        play(
          out,
          [
            { opacity: 1, filter: "blur(0)", transform: "none" },
            { opacity: 0, filter: "blur(4px)", transform: "translateX(12px)" },
          ],
          at,
          200,
          "ease-out"
        )
      play(
        into,
        [
          { opacity: 0, filter: "blur(4px)", transform: "translateX(12px)" },
          { opacity: 1, filter: "blur(0)", transform: "none" },
        ],
        at + 60,
        260,
        "ease-out"
      )
    }

    const below: HTMLElement[] = []
    const above: HTMLElement[] = []
    // Absorb: old capsules without a partner slide into their neighbor.
    before.forEach((capsule, index) => {
      if (index < paired) return
      const element = stand(capsule.box)
      element.append(face(capsule, "left"))
      below.push(element)
      if (!paired) return fade(element, false, 0, 8)
      const neighbor = before[paired - 1].box
      play(
        element,
        [place(capsule.box), place(tucked(neighbor, capsule.box))],
        0
      )
      fade(element, false, 0)
    })
    // Resize: paired capsules travel and resize, contents cross-fading.
    for (let index = 0; index < paired; index++) {
      const element = stand(before[index].box)
      const old = face(before[index], "right")
      const next = face(after[index], "right")
      element.append(old, next)
      above.push(element)
      play(
        element,
        [place(before[index].box), place(after[index].box)],
        resizeAt
      )
      crossFade(old, next, resizeAt)
    }
    // Split: new capsules without a partner come out of their neighbor.
    after.forEach((capsule, index) => {
      if (index < paired) return
      const element = stand(capsule.box)
      const next = face(capsule, "left")
      element.append(next)
      below.push(element)
      if (!paired) return fade(element, true, 0, 8)
      const neighbor = after[paired - 1].box
      play(
        element,
        [place(tucked(neighbor, capsule.box)), place(capsule.box)],
        splitAt
      )
      fade(element, true, splitAt)
      crossFade(null, next, splitAt)
    })
    // Capsules that tuck away or come out pass behind their neighbors.
    layer.replaceChildren(...below, ...above)
    window.setTimeout(finish, end + 30)
  })
}
