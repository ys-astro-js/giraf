/**
 * 나누기 and 짝 맞추기 under an input in the inspector (lib/splits): the split
 * is set on one file-list input; every other input with several files picks
 * how it pairs to the groups. Both open a menu from a chip showing the token
 * the node shows.
 */
import { useState } from "react"
import { Menu } from "@base-ui/react/menu"
import { Check, ChevronDown } from "lucide-react"
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
import { SearchField } from "@/components/search-field"
import { Choice } from "@/components/workbench-controls"
import { PairToken, SelectToken, SplitToken, TokenIcon } from "@/components/split-token"
import { assigned } from "@/lib/task-map/inputs"
import type { Instance, TaskMap } from "@/lib/task-map"
import type { Frame } from "@/lib/workbench"
import {
  fileLabel,
  framesOf,
  inputFiles,
  keyChoices,
  keyRows,
  sameValue,
  searchKeys,
  setPairing,
  setSelect,
  setSplit,
  splitOf,
  taskGroups,
  toggledParts,
  type KeyRow,
  type PairRule,
  type SelectRule,
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
  const [query, setQuery] = useState("")
  const split = splitOf(task)
  const own = split?.input === role ? split.by : []
  const { ids } = inputFiles(map, task, role, rows)
  const frames = framesOf(map, rows)
  const { rows: keys, hidden } = keyRows(ids, frames, own.flatMap((p) => ("key" in p ? [p.key] : [])))
  const found = query.trim() ? searchKeys(ids, frames, query) : undefined
  const per = own.find((p): p is { per: number } => "per" in p)
  const set = (by: SplitPart[]) => edit((t) => setSplit(t, by.length ? { input: role, by } : undefined))
  const toggle = (part: SplitPart) => set(toggledParts(own, part))
  const keyItem = (row: KeyRow) => (
    <KeyCheckItem key={row.key} row={row} checked={own.some((p) => "key" in p && p.key === row.key)} onCheckedChange={() => toggle({ key: row.key })} />
  )
  return (
    <ul className="input-files pass-files split-controls" aria-label={`${role} 나누기`}>
      <Row label="나누기">
        <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
          <DropdownMenuTrigger render={<button type="button" />} className={chipClass} aria-label={`${role} 나누기`}>
            {own.length ? <SplitToken parts={own} /> : <span className="split-token"><TokenIcon icon="split" /><span>나누지 않기</span></span>}
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label={`${role} 나누기`} align="end" className="split-menu">
            {hidden && <KeySearch value={query} onValueChange={setQuery} />}
            {found ? <Found rows={found} item={keyItem} /> : <>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => set([])}>나누지 않기</DropdownMenuItem>
              </DropdownMenuGroup>
              {keys.length > 0 && <DropdownMenuGroup>{keys.map(keyItem)}</DropdownMenuGroup>}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuCheckboxItem checked={!!per} onCheckedChange={() => toggle({ per: per?.per ?? 5 })}>
                  <TokenIcon icon="files" />파일 수
                </DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={own.some((p) => "each" in p)} onCheckedChange={() => toggle({ each: true })}>
                  <TokenIcon icon="file" />파일마다
                </DropdownMenuCheckboxItem>
              </DropdownMenuGroup>
            </>}
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
  const [query, setQuery] = useState("")
  const rule = task.draft.pairing?.[role]
  const { ids } = assigned(map, task, role)
  const frames = framesOf(map, rows)
  // A key pairs a group's files with the candidate of the same value: the split files' keywords
  // that group them come first, then those the candidates hold.
  const split = splitOf(task)
  const splitIds = split ? assigned(map, task, split.input).ids : []
  const chosen = rule && "by" in rule ? [rule.by] : []
  const own = keyRows(splitIds, frames, chosen.filter((key) => splitIds.some((id) => frames.get(id)?.headers?.[key] !== undefined)))
  const listed = (row: KeyRow) => own.rows.some((o) => [o.key, ...o.aliases].some((key) => key === row.key || row.aliases.includes(key)))
  const candidates = keyRows(ids, frames, chosen)
  const keys = [...own.rows, ...candidates.rows.filter((row) => !listed(row))]
  const found = query.trim() ? searchKeys([...new Set([...splitIds, ...ids])], frames, query) : undefined
  const { groups } = taskGroups(map, task, rows)
  const set = (next: PairRule | undefined) => edit((t) => setPairing(t, role, next))
  const value = !rule ? "" : "by" in rule ? `by:${rule.by}` : "order" in rule ? "order" : "iraf" in rule ? "iraf" : "manual"
  const keyItem = (row: KeyRow) => <KeyRadioItem key={row.key} row={row} />
  return (
    <ul className="input-files pass-files split-controls" aria-label={`${role} 짝 맞추기`}>
      <Row label="짝 맞추기">
        <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
          <DropdownMenuTrigger render={<button type="button" />} className={chipClass} aria-label={`${role} 짝 맞추기`}
            data-missing={!rule || undefined}>
            {rule ? <PairToken rule={rule} /> : <span className="split-token"><TokenIcon icon="link" /><span>정하기</span></span>}
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label={`${role} 짝 맞추기`} align="end" className="split-menu">
            {(own.hidden || candidates.hidden) && <KeySearch value={query} onValueChange={setQuery} />}
            <DropdownMenuRadioGroup
              value={value}
              onValueChange={(next: string) =>
                set(next.startsWith("by:") ? { by: next.slice(3) } : next === "order" ? { order: true }
                  : next === "iraf" ? { iraf: true } : { manual: rule && "manual" in rule ? rule.manual : {} })}
            >
              {found ? <Found rows={found} item={keyItem} /> : <>
                {keys.length > 0 && <DropdownMenuLabel>같은 헤더 값</DropdownMenuLabel>}
                {keys.map(keyItem)}
                {keys.length > 0 && <DropdownMenuSeparator />}
                <DropdownMenuRadioItem value="order" closeOnClick>순서대로</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="iraf" closeOnClick>IRAF에 맡기기</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="manual" closeOnClick>직접 고르기</DropdownMenuRadioItem>
              </>}
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

/** 고르기: keep only the files whose header keyword reads the chosen values. */
export function SelectControl({ map, task, role, rows, edit }: Props) {
  const [query, setQuery] = useState("")
  const rule = task.draft.select?.[role]
  const { ids } = assigned(map, task, role)
  const frames = framesOf(map, rows)
  const { rows: keys, hidden } = keyRows(ids, frames, rule ? [rule.key] : [])
  const found = query.trim() ? searchKeys(ids, frames, query) : undefined
  const set = (next: SelectRule | undefined) => edit((t) => setSelect(t, role, next))
  const toggle = (key: string, value: string) => {
    const values = rule?.key === key ? rule.values : []
    set({ key, values: values.some((v) => sameValue(v, value)) ? values.filter((v) => !sameValue(v, value)) : [...values, value] })
  }
  if (!rule && !keyChoices(ids, frames).some((c) => c.values.length > 1)) return null
  const keyRow = (row: KeyRow) => <SelectRow key={row.key} row={row} rule={rule} toggle={toggle} />
  return (
    <ul className="input-files pass-files split-controls" aria-label={`${role} 고르기`}>
      <Row label="고르기">
        <DropdownMenu onOpenChange={(open) => !open && setQuery("")}>
          <DropdownMenuTrigger render={<button type="button" />} className={chipClass} aria-label={`${role} 고르기`}>
            {rule ? <SelectToken rule={rule} /> : <span className="split-token"><TokenIcon icon="select" /><span>모두</span></span>}
            <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent aria-label={`${role} 고르기`} align="end" className="split-menu">
            {hidden && <KeySearch value={query} onValueChange={setQuery} />}
            {found ? <Found rows={found} item={keyRow} /> : <>
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => set(undefined)}>모두</DropdownMenuItem>
              </DropdownMenuGroup>
              {keys.length > 0 && <DropdownMenuSeparator />}
              {keys.map(keyRow)}
            </>}
          </DropdownMenuContent>
        </DropdownMenu>
      </Row>
    </ul>
  )
}

const itemClass = "flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"

/** A keyword row's name, the keywords that group the files the same way, and up to three of its values. */
function KeyLabel({ row, values = true }: { row: KeyRow; values?: boolean }) {
  return (
    <>
      <span className="shrink-0 font-mono">{row.key}</span>
      {row.aliases.length > 0 && <span className="split-key-alias font-mono">{row.aliases.join(" ")}</span>}
      {values && (
        <span className="split-choice-values">
          {row.values.slice(0, 3).map((v) => <span key={v}>{v}</span>)}
          {row.values.length > 3 && <span>…</span>}
        </span>
      )}
    </>
  )
}

// The check keeps its column when off, so the values line up.
const indicatorClass = "flex w-4 shrink-0 data-unchecked:invisible"

function KeyCheckItem({ row, checked, onCheckedChange }: { row: KeyRow; checked: boolean; onCheckedChange: () => void }) {
  return (
    <Menu.CheckboxItem className={itemClass} checked={checked} onCheckedChange={onCheckedChange}>
      <KeyLabel row={row} />
      <Menu.CheckboxItemIndicator keepMounted className={indicatorClass}><Check /></Menu.CheckboxItemIndicator>
    </Menu.CheckboxItem>
  )
}

function KeyRadioItem({ row }: { row: KeyRow }) {
  return (
    <Menu.RadioItem className={itemClass} value={`by:${row.key}`} closeOnClick>
      <KeyLabel row={row} />
      <Menu.RadioItemIndicator keepMounted className={indicatorClass}><Check /></Menu.RadioItemIndicator>
    </Menu.RadioItem>
  )
}

/** 고르기's row: a keyword and its values, each a chip that keeps or drops its files. */
function SelectRow({ row, rule, toggle }: { row: KeyRow; rule: SelectRule | undefined; toggle: (key: string, value: string) => void }) {
  return (
    <Menu.Group className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm" aria-label={row.key}>
      <KeyLabel row={row} values={false} />
      <span className="select-chips">
        {row.values.map((v) => (
          <Menu.CheckboxItem key={v} className="partition-chip select-chip" title={v}
            checked={rule?.key === row.key && rule.values.some((r) => sameValue(r, v))} onCheckedChange={() => toggle(row.key, v)}>
            {v}
          </Menu.CheckboxItem>
        ))}
      </span>
    </Menu.Group>
  )
}

/** Searches every keyword the files hold; shown when the menu leaves some out. */
function KeySearch({ value, onValueChange }: { value: string; onValueChange: (value: string) => void }) {
  return (
    <div className="split-menu-search">
      <SearchField
        label="키워드 검색"
        value={value}
        onValueChange={onValueChange}
        // Typing stays in the field; arrows, Tab and Escape still move through or close the menu.
        onKeyDown={(e) => { if (!["ArrowDown", "ArrowUp", "Tab", "Escape"].includes(e.key)) e.stopPropagation() }}
      />
    </div>
  )
}

function Found({ rows, item }: { rows: KeyRow[]; item: (row: KeyRow) => React.ReactNode }) {
  if (!rows.length) return <div className="px-3 py-2 text-sm text-muted-foreground">없음</div>
  return <DropdownMenuGroup>{rows.map(item)}</DropdownMenuGroup>
}
