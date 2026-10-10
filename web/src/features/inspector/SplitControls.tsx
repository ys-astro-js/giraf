/**
 * 나누기 and 짝 맞추기 under an input in the inspector (lib/splits): the split
 * is set on one file-list input; every other input with several files picks
 * how it pairs to the groups. Both open a menu from a chip showing the token
 * the node shows.
 */
import { ChevronDown } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Choice } from "@/components/workbench-controls"
import { PairToken, SplitToken, TokenIcon } from "@/components/split-token"
import { assigned } from "@/lib/task-map/inputs"
import type { Instance, TaskMap } from "@/lib/task-map"
import type { Frame } from "@/lib/workbench"
import {
  fileLabel,
  framesOf,
  keyChoices,
  setPairing,
  setSplit,
  splitOf,
  taskGroups,
  toggledParts,
  type PairRule,
  type SplitPart,
} from "@/lib/splits"

type Props = {
  map: TaskMap
  task: Instance
  role: string
  rows: Frame[]
  edit: (fn: (t: Instance) => Instance) => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <li className="split-control">
      <span>{label}</span>
      <span className="pass-value">{children}</span>
    </li>
  )
}

const chipClass = "split-chip nodrag"

/** 나누기: which header keywords, how many files a group, or a group per file. */
export function SplitControl({ map, task, role, rows, edit }: Props) {
  const split = splitOf(task)
  const own = split?.input === role ? split.by : []
  const { ids } = assigned(map, task, role)
  const frames = framesOf(map, rows)
  const keys = keyChoices(ids, frames, own.flatMap((p) => ("key" in p ? [p.key] : [])))
  const per = own.find((p): p is { per: number } => "per" in p)
  const set = (by: SplitPart[]) => edit((t) => setSplit(t, by.length ? { input: role, by } : undefined))
  const toggle = (part: SplitPart) => set(toggledParts(own, part))
  return (
    <ul className="input-files pass-files split-controls" aria-label={`${role} 나누기`}>
      <Row label="나누기">
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" />} className={chipClass} aria-label={`${role} 나누기`}>
            {own.length ? <SplitToken parts={own} /> : <span className="split-token"><TokenIcon icon="split" /><span>나누지 않기</span></span>}
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label={`${role} 나누기`} align="end">
            <DropdownMenuGroup>
              <DropdownMenuItem onClick={() => set([])}>나누지 않기</DropdownMenuItem>
            </DropdownMenuGroup>
            {keys.length > 0 && <DropdownMenuSeparator />}
            {keys.length > 0 && (
              <DropdownMenuGroup>
                <DropdownMenuLabel>헤더 키워드</DropdownMenuLabel>
                {keys.map(({ key, values }) => (
                  <DropdownMenuCheckboxItem key={key} checked={own.some((p) => "key" in p && p.key === key)} onCheckedChange={() => toggle({ key })}>
                    <span className="font-mono">{key}</span>
                    <span className="split-choice-values">{values.slice(0, 4).join(" ")}{values.length > 4 ? " …" : ""}</span>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuCheckboxItem checked={!!per} onCheckedChange={() => toggle({ per: per?.per ?? 5 })}>
                <TokenIcon icon="files" />파일 수
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem checked={own.some((p) => "each" in p)} onCheckedChange={() => toggle({ each: true })}>
                <TokenIcon icon="file" />파일마다
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
      {per && (
        <Row label="파일 수">
          <Input
            className="split-count"
            aria-label={`${role} 파일 수`}
            inputMode="numeric"
            value={String(per.per)}
            onChange={(e) => {
              const n = Math.floor(Number(e.target.value))
              if (Number.isFinite(n) && n >= 1) set(own.map((p) => ("per" in p ? { per: n } : p)))
            }}
          />
        </Row>
      )}
    </ul>
  )
}

/** 짝 맞추기: how an input with several files gives each group its own. */
export function PairControl({ map, task, role, rows, edit }: Props) {
  const rule = task.draft.pairing?.[role]
  const { ids } = assigned(map, task, role)
  const frames = framesOf(map, rows)
  // A key pairs a group's files with the candidate of the same value: the split files' keywords
  // that differ between them come first, then those the candidates hold.
  const split = splitOf(task)
  const own = split ? keyChoices(assigned(map, task, split.input).ids, frames).filter((c) => c.values.length > 1) : []
  const keys = [...own, ...keyChoices(ids, frames, rule && "by" in rule ? [rule.by] : []).filter((c) => !own.some((o) => o.key === c.key))]
  const { groups } = taskGroups(map, task, rows)
  const set = (next: PairRule | undefined) => edit((t) => setPairing(t, role, next))
  const value = !rule ? "" : "by" in rule ? `by:${rule.by}` : "order" in rule ? "order" : "iraf" in rule ? "iraf" : "manual"
  return (
    <ul className="input-files pass-files split-controls" aria-label={`${role} 짝 맞추기`}>
      <Row label="짝 맞추기">
        <DropdownMenu>
          <DropdownMenuTrigger render={<button type="button" />} className={chipClass} aria-label={`${role} 짝 맞추기`}
            data-missing={!rule || undefined}>
            {rule ? <PairToken rule={rule} /> : <span className="split-token"><TokenIcon icon="link" /><span>정하기</span></span>}
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label={`${role} 짝 맞추기`} align="end">
            <DropdownMenuRadioGroup
              value={value}
              onValueChange={(next: string) =>
                set(next.startsWith("by:") ? { by: next.slice(3) } : next === "order" ? { order: true }
                  : next === "iraf" ? { iraf: true } : { manual: rule && "manual" in rule ? rule.manual : {} })}
            >
              {keys.length > 0 && <DropdownMenuLabel>같은 헤더 값</DropdownMenuLabel>}
              {keys.map(({ key, values }) => (
                <DropdownMenuRadioItem key={key} value={`by:${key}`} closeOnClick>
                  <span className="font-mono">{key}</span>
                  <span className="split-choice-values">{values.slice(0, 4).join(" ")}{values.length > 4 ? " …" : ""}</span>
                </DropdownMenuRadioItem>
              ))}
              {keys.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuRadioItem value="order" closeOnClick>순서대로</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="iraf" closeOnClick>IRAF에 맡기기</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="manual" closeOnClick>직접 고르기</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
      {rule && "manual" in rule && groups?.map((group) => (
        <Row key={group.id} label={group.name}>
          <Choice
            label={`${group.name} ${role}`}
            value={rule.manual[group.id] ?? ""}
            options={ids.map((id) => ({ value: id, label: fileLabel(frames, id) }))}
            onChange={(id) => set({ manual: { ...rule.manual, [group.id]: id } })}
          />
        </Row>
      ))}
    </ul>
  )
}
