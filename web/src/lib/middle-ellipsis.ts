export function middleEllipsis(
  text: string,
  width: number,
  measure: (text: string) => number
): string {
  if (measure(text) <= width) return text
  if (measure("…") > width) return ""
  const characters = Array.from(text)
  const shorten = (keep: number) => {
    const start = Math.floor(keep / 2)
    const end = keep - start
    return (
      characters.slice(0, start).join("") +
      "…" +
      (end ? characters.slice(-end).join("") : "")
    )
  }
  let low = 0
  let high = characters.length - 1
  while (low < high) {
    const keep = Math.ceil((low + high) / 2)
    if (measure(shorten(keep)) <= width) low = keep
    else high = keep - 1
  }
  return shorten(low)
}
