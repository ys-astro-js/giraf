import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion"
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyMedia,
} from "@/components/ui/empty"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { FolderOpen, AlertCircle } from "lucide-react"
import { primaryParameters, type Param, type Values } from "@/lib/workbench"

export function ParameterHelp({
  p,
  id,
}: {
  p: Pick<Param, "name" | "prompt" | "min" | "max" | "required" | "indirect">
  id: string
}) {
  const bounds = [
    { label: "최소", value: p.min },
    { label: "최대", value: p.max },
  ].filter((item) => item.value !== "" && item.value != null)
  if (!p.prompt && !bounds.length && !p.indirect) {
    return <span id={id} className="sr-only" />
  }
  return (
    <div id={id} className="parameter-description">
      {p.prompt && <FieldDescription>{p.prompt}</FieldDescription>}
      {bounds.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
          {bounds.map((item) => (
            <div key={item.label} className="flex gap-2">
              <dt>{item.label}</dt>
              <dd>{String(item.value)}</dd>
            </div>
          ))}
        </dl>
      )}
      {p.indirect && (
        <FieldDescription>
          기본값을 유지하면 IRAF에서 참조 값을 가져옵니다.
        </FieldDescription>
      )}
    </div>
  )
}

type ChoiceOption = {
  value: string
  label: string
  description?: string
  count?: number
}

function ChoiceLabel({ option }: { option: ChoiceOption }) {
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
      <span>
        {option.count === undefined
          ? option.label
          : `${option.label} ${option.count}개`}
      </span>
      {option.description && (
        <span className="text-muted-foreground">{option.description}</span>
      )}
    </span>
  )
}

export function Choice({
  value,
  options,
  onChange,
  label,
  id,
  describedBy,
  required,
}: {
  value: string
  options: ChoiceOption[]
  onChange: (value: string) => void
  label: string
  id?: string
  describedBy?: string
  required?: boolean
}) {
  const selected = options.find((option) => option.value === value)
  return (
    <Select
      value={value}
      items={options}
      onValueChange={(next) => {
        if (next !== null) onChange(next)
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={label}
        aria-describedby={describedBy}
        aria-required={required || undefined}
        className="w-full"
      >
        <SelectValue>
          {() => (selected ? <ChoiceLabel option={selected} /> : value)}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <ChoiceLabel option={option} />
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  )
}
export function Parameters({
  parameters,
  values,
  onChange,
  scope,
  all = false,
}: {
  parameters: Param[]
  values: Values
  onChange: (key: string, value: string) => void
  scope: string
  all?: boolean
}) {
  const field = (p: Param) => {
    const id = `${scope}-${p.name}`,
      value = String(values[p.name] ?? p.default ?? "")
    return (
      <Field
        key={p.name}
        className="parameter-field"
        data-boolean={p.type === "b"}
      >
        <FieldLabel htmlFor={id}>
          {p.name}
          {p.required && <span aria-hidden="true">*</span>}
        </FieldLabel>
        {p.type === "b" ? (
          <Switch
            id={id}
            aria-describedby={`${id}-description`}
            aria-required={p.required || undefined}
            checked={value === "yes"}
            onCheckedChange={(checked) =>
              onChange(p.name, checked ? "yes" : "no")
            }
          />
        ) : p.choices.length ? (
          <Choice
            id={id}
            describedBy={`${id}-description`}
            required={p.required}
            label={p.name}
            options={p.choices.map((v) => ({ value: v, label: v }))}
            value={value}
            onChange={(v) => onChange(p.name, v)}
          />
        ) : (
          <Input
            id={id}
            aria-describedby={`${id}-description`}
            aria-required={p.required || undefined}
            value={value}
            inputMode={["r", "d", "i"].includes(p.type) ? "decimal" : undefined}
            onChange={(e) => onChange(p.name, e.target.value)}
          />
        )}
        <ParameterHelp p={p} id={`${id}-description`} />
      </Field>
    )
  }
  const common = parameters.filter((p) => all || primaryParameters.has(p.name)),
    advanced = parameters.filter((p) => !all && !primaryParameters.has(p.name))
  return (
    <div className="flex flex-col gap-6">
      <FieldGroup className="grid grid-cols-1 items-start gap-6 @lg/parameters:grid-cols-2">
        {common.map(field)}
      </FieldGroup>
      {advanced.length > 0 && (
        <Accordion>
          <AccordionItem value="advanced">
            <AccordionTrigger>전체 파라미터</AccordionTrigger>
            <AccordionContent>
              <FieldGroup className="grid grid-cols-1 items-start gap-6 @lg/parameters:grid-cols-2">
                {advanced.map(field)}
              </FieldGroup>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      )}
    </div>
  )
}
export function Blank({
  children,
  action,
}: {
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <FolderOpen />
        </EmptyMedia>
        <EmptyTitle>{children}</EmptyTitle>
      </EmptyHeader>
      {action}
    </Empty>
  )
}
export function Failure({ message }: { message: string }) {
  return message ? (
    <Alert variant="destructive">
      <AlertCircle />
      <AlertDescription className="whitespace-pre-wrap">
        {message}
      </AlertDescription>
    </Alert>
  ) : null
}
export function Download({ id }: { id: string }) {
  return (
    <Button
      variant="outline"
      nativeButton={false}
      render={<a href={`/api/download?id=${id}`} download />}
    >
      저장
    </Button>
  )
}
