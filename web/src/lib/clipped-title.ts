/**
 * A node label cut off with an ellipsis shows its full text on hover. Labels
 * carry the text in `data-full-text`; the canvas sets `title` from it as the
 * pointer arrives, so a label that fits shows no tooltip.
 */
export function clippedTitle(
  label: { scrollWidth: number; clientWidth: number },
  full: string
): string {
  return label.scrollWidth > label.clientWidth ? full : ""
}
