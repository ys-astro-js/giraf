/**
 * The muted icon-and-word tokens of 나눠서 실행 (lib/splits), shared by the
 * node and the inspector: `Split FILTER`, `Split EXPTIME Files 5`,
 * `Split File`, `Link EXPTIME`. Icons use the node's file icon metrics
 * (.node-input-file); words and explanations stay in the inspector.
 */
import { Crosshair, File, Files, Filter, Link, Sigma, Split, Tag } from "lucide-react"
import type { PairRule, SelectRule, SplitPart } from "@/lib/splits"

const ICONS = { select: Filter, split: Split, file: File, files: Files, link: Link, formula: Sigma, measure: Crosshair, header: Tag }
export type TokenIcon = keyof typeof ICONS
const NAMES: Record<TokenIcon, string> = {
  select: "고르기", split: "나누기", file: "파일", files: "파일", link: "짝 맞추기", formula: "식", measure: "측정값", header: "헤더",
}

export function TokenIcon({ icon }: { icon: TokenIcon }) {
  const Icon = ICONS[icon]
  return <Icon className="node-input-file" role="img" aria-label={NAMES[icon]} />
}

export function SplitToken({ parts }: { parts: SplitPart[] }) {
  return (
    <span className="split-token">
      <TokenIcon icon="split" />
      {parts.map((part, i) =>
        "key" in part ? <span key={i}>{part.key}</span>
        : "per" in part ? <span key={i} className="split-token-count"><TokenIcon icon="files" />{part.per}</span>
        : <TokenIcon key={i} icon="file" />
      )}
    </span>
  )
}

/** 고르기: the header keyword and the values an input keeps (`SUBSET B`). */
export function SelectToken({ rule }: { rule: SelectRule }) {
  return (
    <span className="split-token">
      <TokenIcon icon="select" />
      <span>{[rule.key, ...rule.values].join(" ")}</span>
    </span>
  )
}

/** How an input pairs to groups, in a few words. */
export function pairText(rule: PairRule): string {
  if ("by" in rule) return rule.by
  if ("order" in rule) return "순서대로"
  if ("iraf" in rule) return "IRAF에 맡기기"
  return "직접 고르기"
}

export function PairToken({ rule }: { rule: PairRule }) {
  return (
    <span className="split-token">
      <TokenIcon icon="link" />
      <span>{"by" in rule ? rule.by : "order" in rule ? "순서대로" : "iraf" in rule ? "IRAF" : "직접"}</span>
    </span>
  )
}
