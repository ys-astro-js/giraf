import { useRef, useState, type ComponentProps, type ReactNode } from "react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { isClipped } from "@/lib/clipped-title"

export type RowTooltipParts = { description?: string; value: boolean }

/**
 * What a node row's tooltip shows: the IRAF name always, its description when it
 * says more than the name, and the value only when the row cuts it off. Nothing
 * to add (no description, nothing clipped) opens no tooltip.
 */
export function rowTooltipParts(row: {
  name: string
  about?: string
  hasValue: boolean
  valueClipped: boolean
  nameClipped: boolean
}): RowTooltipParts | null {
  const about = row.about?.trim()
  const description = about && about !== row.name ? about : undefined
  const value = row.hasValue && row.valueClipped
  if (!description && !value && !row.nameClipped) return null
  return { description, value }
}

type RowTooltipProps = Omit<ComponentProps<typeof TooltipTrigger>, "children" | "value" | "ref"> & {
  /** The IRAF parameter or role name. */
  name: string
  /** The IRAF description (prompt). */
  about?: string
  /** The row's value as the row draws it; omitted when the row's own chips carry it. */
  value?: ReactNode
  /** The node the value comes from. */
  from?: string
  mono?: boolean
  disabled?: boolean
  children: ReactNode
}

/**
 * A node input or parameter row with its tooltip. The row marks its name and value
 * elements with `data-row-name` and `data-row-value`; clipping is measured as the
 * tooltip opens.
 */
export function RowTooltip({ name, about, value, from, mono, disabled, children, ...trigger }: RowTooltipProps) {
  const ref = useRef<HTMLButtonElement>(null)
  const [parts, setParts] = useState<RowTooltipParts>({ value: false })
  return (
    <Tooltip
      disabled={disabled}
      onOpenChange={(open, details) => {
        if (!open) return
        const row = ref.current
        const valueLabel = row?.querySelector<HTMLElement>("[data-row-value]")
        const nameLabel = row?.querySelector<HTMLElement>("[data-row-name]")
        const next = rowTooltipParts({
          name,
          about,
          hasValue: value != null && value !== "",
          valueClipped: !!valueLabel && isClipped(valueLabel),
          nameClipped: !!nameLabel && isClipped(nameLabel),
        })
        if (!next) {
          details.cancel()
          return
        }
        setParts(next)
      }}
    >
      <TooltipTrigger ref={ref} {...trigger}>
        {children}
      </TooltipTrigger>
      <TooltipContent className="node-row-tooltip flex-col items-start gap-1">
        <span className="font-mono text-[11px] leading-4 text-background/60">{name}</span>
        {parts.description && <span className="leading-4">{parts.description}</span>}
        {parts.value && (
          <span className="mt-0.5 flex flex-col gap-0.5 self-stretch border-t border-background/20 pt-1.5">
            <span className={mono ? "font-mono [overflow-wrap:anywhere]" : "[overflow-wrap:anywhere]"}>{value}</span>
            {from && <span className="text-background/60">{from}에서 받은 값</span>}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  )
}
