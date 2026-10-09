/**
 * A region's expression criterion and condition, read in the editor where the
 * files' headers are known (giraf/values.py evaluate_expression on one file):
 * numbers, quoted text, header names, + - * / % **, comparisons, && || !, and
 * the one-value functions. Anything else is left to the run.
 */
type Value = number | string | boolean
type Token = { kind: "number" | "text" | "name" | "op"; text: string }

const FUNCTIONS: Record<string, (x: number) => number> = {
  abs: Math.abs, sqrt: Math.sqrt, exp: Math.exp, log: Math.log, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan, nint: Math.round, int: Math.trunc, real: (x) => x, double: (x) => x,
}

function tokens(text: string): Token[] {
  const found: Token[] = []
  const pattern = /\s*(?:(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?)|"([^"]*)"|'([^']*)'|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|==|!=|<=|>=|&&|\|\||[-+*/%<>!(),]))/iy
  let at = 0
  while (at < text.length) {
    if (!text.slice(at).trim()) break
    pattern.lastIndex = at
    const m = pattern.exec(text)
    if (!m) throw Error("식을 읽지 못했습니다.")
    at = pattern.lastIndex
    if (m[1] !== undefined) found.push({ kind: "number", text: m[1] })
    else if (m[2] !== undefined || m[3] !== undefined) found.push({ kind: "text", text: m[2] ?? m[3] })
    else if (m[4] !== undefined) found.push({ kind: "name", text: m[4] })
    else found.push({ kind: "op", text: m[5] })
  }
  return found
}

const BINARY: Record<string, number> = { "||": 1, "&&": 2, "==": 3, "!=": 3, "<": 3, "<=": 3, ">": 3, ">=": 3, "+": 4, "-": 4, "*": 5, "/": 5, "%": 5, "**": 7 }

/** A header's text as a number when it reads as one, as giraf/values.py _scalar. */
function scalar(text: string): Value {
  const value = Number(text)
  return text.trim() !== "" && Number.isFinite(value) ? value : text.trim()
}

/**
 * Evaluate `text` for one file whose values `lookup` gives by name; undefined
 * when a name has no value here or the expression needs the run.
 */
export function evaluateExpression(text: string, lookup: (name: string) => string | undefined): Value | undefined {
  let list: Token[]
  try {
    list = tokens(text)
  } catch {
    return undefined
  }
  let i = 0
  const fail = () => { throw Error("식") }
  const number = (v: Value) => (typeof v === "number" ? v : typeof v === "boolean" ? Number(v) : fail()) as number
  function primary(): Value {
    const token = list[i++]
    if (!token) return fail()
    if (token.kind === "number") return Number(token.text)
    if (token.kind === "text") return token.text
    if (token.kind === "name") {
      if (list[i]?.text === "(") {
        i++
        const arg = expression(0)
        if (list[i++]?.text !== ")" || !FUNCTIONS[token.text]) return fail()
        return FUNCTIONS[token.text](number(arg))
      }
      const value = lookup(token.text)
      return value === undefined ? fail() : scalar(value)
    }
    if (token.text === "(") {
      const value = expression(0)
      if (list[i++]?.text !== ")") fail()
      return value
    }
    if (token.text === "-") return -number(unary())
    if (token.text === "+") return number(unary())
    if (token.text === "!") return !truthy(unary())
    return fail()
  }
  const unary = () => primary()
  const truthy = (v: Value) => (typeof v === "string" ? v !== "" : !!v)
  function expression(min: number): Value {
    let left = unary()
    for (;;) {
      const op = list[i]?.text
      const power = op && list[i]?.kind === "op" ? BINARY[op] : undefined
      if (power === undefined || power < min) return left
      i++
      // ** binds to the right; the others to the left.
      const right = expression(op === "**" ? power : power + 1)
      left = apply(op!, left, right)
    }
  }
  function apply(op: string, a: Value, b: Value): Value {
    if (op === "&&") return truthy(a) && truthy(b)
    if (op === "||") return truthy(a) || truthy(b)
    if (["==", "!=", "<", "<=", ">", ">="].includes(op)) {
      const [x, y] = typeof a === "string" || typeof b === "string" ? [String(a), String(b)] : [number(a), number(b)]
      return op === "==" ? x === y : op === "!=" ? x !== y : op === "<" ? x < y : op === "<=" ? x <= y : op === ">" ? x > y : x >= y
    }
    if (op === "+" && typeof a === "string" && typeof b === "string") return a + b
    const [x, y] = [number(a), number(b)]
    return op === "+" ? x + y : op === "-" ? x - y : op === "*" ? x * y : op === "/" ? x / y : op === "%" ? x % y : x ** y
  }
  try {
    const value = expression(0)
    return i === list.length ? value : undefined
  } catch {
    return undefined
  }
}

/** A value as a round names it (giraf/flows.py _text): `30.0`, `True`, `B`. */
export function expressionText(value: Value): string {
  if (typeof value === "boolean") return value ? "True" : "False"
  if (typeof value === "number") return Number.isInteger(value) ? `${value}.0` : String(value)
  return value.trim()
}
