/** The toolbar's shift (see toolbar.css --motion-shift, --motion-ease). */
export const SHIFT = 380
export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)"

export const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches

/**
 * Runs once a change has rendered and laid out: after two frames, or a
 * short timer when frames are not coming (a hidden window).
 */
export function afterRender(run: () => void) {
  let ran = false
  const once = () => {
    if (ran) return
    ran = true
    run()
  }
  requestAnimationFrame(() => requestAnimationFrame(once))
  window.setTimeout(once, 50)
}
