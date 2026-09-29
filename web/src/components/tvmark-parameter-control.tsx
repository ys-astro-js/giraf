import { Choice } from "./workbench-controls"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { tvmarkColors } from "@/lib/tvmark"

const shapes = [
  {value:"point",label:"· point"}, {value:"circle",label:"○ circle"},
  {value:"rectangle",label:"□ rectangle"}, {value:"line",label:"／ line"},
  {value:"plus",label:"＋ plus"}, {value:"cross",label:"× cross"}, {value:"none",label:"none"},
]

export function TvmarkParameterControl({ name, value, onChange, id }: {
  name: string
  value: string
  onChange: (value: string) => void
  id: string
}) {
  if (name === "mark") return <Choice id={id} label="mark" describedBy={`${id}-description`} value={value} options={shapes} onChange={onChange} />
  if (name === "color") {
    const selected = tvmarkColors.find(option => option.value === value)
    const items = [...tvmarkColors, {value:"gray",label:"회색조",color:`rgb(${value}, ${value}, ${value})`}]
    const swatch = (option: typeof items[number]) => <span className="flex items-center gap-2"><span aria-hidden="true" className="size-3 shrink-0 rounded-sm border border-border" style={{backgroundColor:option.color}} />{option.value !== "gray" && <span className="tabular-nums">{option.value}</span>}<span>{option.label}</span></span>
    return <div className="flex flex-col gap-2">
      <Select value={selected?.value || "gray"} items={items} onValueChange={next => { if(next !== null) onChange(next === "gray" ? "128" : next) }}>
        <SelectTrigger id={id} aria-label="color" aria-describedby={`${id}-description`} className="w-full"><SelectValue>{() => swatch(selected || items[items.length - 1])}</SelectValue></SelectTrigger>
        <SelectContent><SelectGroup>{items.map(option => <SelectItem key={option.value} value={option.value}>{swatch(option)}</SelectItem>)}</SelectGroup></SelectContent>
      </Select>
      {!selected && <Input type="number" min={0} max={255} step={1} aria-label="회색조 color 번호" value={value} onChange={event => onChange(event.target.value)} />}
    </div>
  }
  return <Input id={id} type="number" step={name === "tolerance" ? "any" : 1} min={["frame","pointsize","txsize"].includes(name) ? 1 : name === "tolerance" ? 0 : undefined} aria-label={name} aria-describedby={`${id}-description`} value={value} onChange={event => onChange(event.target.value)} />
}
