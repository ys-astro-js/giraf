/** IRAF display graphics colours (tvmark color parameter). */
export const tvmarkColors = [
  { value: "201", label: "커서 흰색", color: "white" },
  ...[
    ["검정", "black"], ["흰색", "white"], ["빨강", "red"], ["초록", "green"],
    ["파랑", "blue"], ["노랑", "yellow"], ["청록", "cyan"], ["자홍", "magenta"],
    ["산호색", "coral"], ["적갈색", "maroon"], ["주황", "orange"], ["카키", "khaki"],
    ["난초색", "orchid"], ["터키색", "turquoise"], ["보라", "violet"], ["밀색", "wheat"],
  ].map(([label, color], index) => ({ value: String(202 + index), label, color })),
  { value: "255", label: "흰색", color: "rgb(255, 255, 255)" },
]
