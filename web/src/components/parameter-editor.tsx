import { useEffect, useRef, useState, type RefObject } from "react"
import { TableOfContents } from "lucide-react"
import { ParameterTable } from "./parameter-fields"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  filterParameterGroups,
  type ParameterGroup,
} from "@/lib/parameter-presentation"

const sectionSelector = "[data-parameter-group]"

export function ParameterEditorFields({
  groups,
  query,
  changedOnly,
  hasOtherResults = false,
  task,
}: {
  groups: ParameterGroup[]
  query: string
  changedOnly: boolean
  hasOtherResults?: boolean
  task?: string
}) {
  const visible = filterParameterGroups(groups, query, changedOnly)
  return (
    <>
      {visible.map((group) => (
        <section
          key={group.id}
          className="parameter-editor-section"
          aria-label={group.label}
          data-parameter-group={group.id}
        >
          <h3 tabIndex={-1}>{group.label}</h3>
          <ParameterTable
            task={group.id === "task" ? task : undefined}
            parameters={group.parameters}
            values={group.values}
            change={group.change}
            scope={`editor-${group.id}`}
            showInactive
          />
        </section>
      ))}
      {!visible.length && !hasOtherResults && (
        <p role="status" className="text-muted-foreground">
          {changedOnly && !query.trim()
            ? "변경한 파라미터가 없습니다."
            : "검색 결과가 없습니다. 이름이나 검색 조건을 확인해 주세요."}
        </p>
      )}
    </>
  )
}

/** The group whose heading last passed the top edge of the scroll area. */
function currentGroup(body: HTMLElement): string | undefined {
  const sections = [...body.querySelectorAll<HTMLElement>(sectionSelector)]
  if (!sections.length) return undefined
  const top = body.getBoundingClientRect().top + 8
  let current = sections[0]
  for (const section of sections) {
    if (section.getBoundingClientRect().top <= top) current = section
    else break
  }
  // A short final group can never reach the top; reaching the end selects it.
  if (body.scrollTop + body.clientHeight >= body.scrollHeight - 2)
    current = sections.at(-1)!
  return current.dataset.parameterGroup
}

/**
 * Jumps between parameter groups (task, psets, package) in a scroll area and
 * follows the reader's scroll position. Presentation only; values are untouched.
 */
export function ParameterGroupNav({
  groups,
  query,
  changedOnly,
  bodyRef,
}: {
  groups: ParameterGroup[]
  query: string
  changedOnly: boolean
  bodyRef: RefObject<HTMLElement | null>
}) {
  const visible = filterParameterGroups(groups, query, changedOnly)
  const items = visible.map((g) => ({ value: g.id, label: g.label }))
  const key = items.map((i) => i.value).join("\n")
  const [active, setActive] = useState<string>()
  // A chosen group stays selected until its scroll settles.
  const chosen = useRef<string>(undefined)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  // Closing the menu interrupts a smooth scroll, so the jump waits for it.
  const pending = useRef<string>(undefined)

  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    const sync = () => {
      if (!chosen.current) return setActive(currentGroup(body))
      clearTimeout(settle.current)
      settle.current = setTimeout(() => {
        const id = chosen.current
        chosen.current = undefined
        // Keep the choice when it is on screen but cannot reach the top.
        const section = body.querySelector(
          `[data-parameter-group="${CSS.escape(id!)}"]`
        )
        const top = section?.getBoundingClientRect().top ?? -1
        const box = body.getBoundingClientRect()
        setActive(
          top >= box.top - 8 && top < box.bottom ? id : currentGroup(body)
        )
      }, 150)
    }
    sync()
    body.addEventListener("scroll", sync, { passive: true })
    return () => {
      body.removeEventListener("scroll", sync)
      clearTimeout(settle.current)
    }
  }, [bodyRef, key])

  if (items.length < 2) return null
  const value = items.some((i) => i.value === active) ? active! : items[0].value

  function jump(id: string) {
    const body = bodyRef.current
    const section = body?.querySelector<HTMLElement>(
      `[data-parameter-group="${CSS.escape(id)}"]`
    )
    if (!body || !section) return
    chosen.current = id
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    body.scrollTo({
      top:
        body.scrollTop +
        section.getBoundingClientRect().top -
        body.getBoundingClientRect().top,
      behavior: reduce ? "auto" : "smooth",
    })
    // Continue keyboard navigation from the group heading.
    section.querySelector("h3")?.focus({ preventScroll: true })
  }

  return (
    <Select
      value={value}
      items={items}
      onValueChange={(next) => {
        if (next === null) return
        setActive(next)
        chosen.current = next
        pending.current = next
      }}
      onOpenChangeComplete={(open) => {
        const id = pending.current
        pending.current = undefined
        if (!open && id) jump(id)
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label="설정 그룹 이동"
        className="parameter-group-nav w-full"
      >
        <TableOfContents className="text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="start">
        <SelectGroup>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
