/**
 * Switching tabs morphs a window's top bar capsule by capsule. Each tab
 * brings its own toolbar, so while the switch plays, the bar hides its real
 * capsules' backgrounds and draws stand-in capsules that travel from the old
 * layout to the new one; the real ones take over when they arrive.
 *
 * The trailing section is anchored at its end: capsules pair up from the
 * right. In order, a capsule with no partner in the new layout is absorbed
 * into its right-hand neighbor, paired capsules resize (a lone button grows
 * into a group), and a new capsule with no partner splits out of its
 * neighbor. Where there is no neighbor at all, capsules materialize (blur in
 * or out). Old contents fade out at once; new contents fade in as their
 * capsule arrives.
 */

const PHASE = 200
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"
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

/** A capsule tucked behind a neighbor's leading edge. */
const tucked = (neighbor: Box, own: Box): Box => ({
  ...own,
  left: neighbor.left,
  width: Math.min(own.height, own.width),
})

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
  row.dataset.morphing = ""
  row.append(layer)

  // The old contents fade where they were.
  const ghosts = before.map(({ element, box }) => {
    const ghost = element.cloneNode(true) as HTMLElement
    ghost.classList.add("window-morph-ghost")
    Object.assign(ghost.style, place(box))
    return ghost
  })
  // Stand-in capsules start on the old layout.
  const stand = before.map(({ box }) => {
    const capsule = document.createElement("div")
    capsule.className = "window-morph-capsule"
    Object.assign(capsule.style, place(box))
    return capsule
  })
  // Leftmost capsules go underneath, so they slide behind their neighbors.
  for (const capsule of [...stand].reverse()) layer.append(capsule)
  for (const ghost of ghosts) layer.append(ghost)

  const animations: Animation[] = []
  let done = false
  const finish = () => {
    if (done) return
    done = true
    delete row.dataset.morphing
    layer.remove()
    for (const animation of animations) animation.cancel()
    running.delete(row)
  }
  running.set(row, finish)
  for (const ghost of ghosts)
    animations.push(
      ghost.animate(
        [
          { opacity: 1, filter: "blur(0)" },
          { opacity: 0, filter: "blur(4px)" },
        ],
        { duration: 140, easing: "ease-in", fill: "forwards" }
      )
    )

  // The new tab's toolbar is in place, with no layout motion of its own.
  afterRender(() => {
    if (done) return
    const after = capsules(row)
    const paired = Math.min(before.length, after.length)
    const leaving = before.length > paired
    const resizing = paired > 0
    const arriving = after.length > paired
    const absorbAt = 0
    const resizeAt = leaving && paired ? PHASE : 0
    const splitAt = resizeAt + (resizing ? PHASE : 0)
    const shapesDone = splitAt + (arriving ? PHASE : 0) || PHASE
    let total = shapesDone

    const play = (
      element: HTMLElement,
      frames: Keyframe[],
      delay: number,
      duration = PHASE
    ) => {
      const animation = element.animate(frames, {
        delay,
        duration,
        easing: EASE,
        fill: "both",
      })
      animations.push(animation)
      return animation
    }
    const materialize = (element: HTMLElement, box: Box, into: boolean) =>
      play(
        element,
        into
          ? [
              { ...place(box), opacity: 0, filter: "blur(8px)" },
              { ...place(box), opacity: 1, filter: "blur(0)" },
            ]
          : [
              { ...place(box), opacity: 1, filter: "blur(0)" },
              { ...place(box), opacity: 0, filter: "blur(8px)" },
            ],
        0
      )

    // Absorb: old capsules without a partner slide into their neighbor.
    before.forEach(({ box }, index) => {
      if (index < paired) return
      const capsule = stand[index]
      if (!paired) return materialize(capsule, box, false)
      const neighbor = before[paired - 1].box
      play(
        capsule,
        [
          { ...place(box), opacity: 1 },
          { ...place(tucked(neighbor, box)), opacity: 0 },
        ],
        absorbAt
      )
    })
    // Resize: paired capsules travel to their new place and size.
    for (let index = 0; index < paired; index++)
      play(
        stand[index],
        [place(before[index].box), place(after[index].box)],
        resizeAt
      )
    // Split: new capsules without a partner come out of their neighbor.
    after.forEach(({ box }, index) => {
      if (index < paired) return
      const capsule = document.createElement("div")
      capsule.className = "window-morph-capsule"
      Object.assign(capsule.style, place(box))
      layer.prepend(capsule)
      if (!paired) return materialize(capsule, box, true)
      const neighbor = after[paired - 1].box
      play(
        capsule,
        [
          { ...place(tucked(neighbor, box)), opacity: 0 },
          { ...place(box), opacity: 1 },
        ],
        splitAt
      )
    })
    // New contents fade in as their capsule arrives.
    after.forEach(({ element }, index) => {
      const arrive =
        index < paired
          ? resizeAt + PHASE * 0.5
          : paired
            ? splitAt + PHASE * 0.5
            : 0
      for (const child of element.children)
        play(
          child as HTMLElement,
          [
            { opacity: 0, filter: "blur(4px)" },
            { opacity: 1, filter: "blur(0)" },
          ],
          arrive,
          PHASE * 0.8
        )
      total = Math.max(total, arrive + PHASE * 0.8)
    })
    window.setTimeout(finish, total + 40)
  })
}
