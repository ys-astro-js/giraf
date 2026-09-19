import { useId } from "react"
import { Funnel } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover"
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldError,
} from "@/components/ui/field"
import { Choice } from "@/components/workbench-controls"
import { CountBadge } from "@/components/count-badge"
import {
  defaultFileFilters,
  exposureError,
  type FileFilters,
} from "@/lib/file-library"

export function FileFilterButton({
  filters,
  bands,
  onChange,
}: {
  filters: FileFilters
  bands: string[]
  onChange: (filters: FileFilters) => void
}) {
  const id = useId()
  const rangeError = exposureError(filters)
  const filterCount =
    Number(filters.kind !== "all") +
    Number(filters.band !== "all") +
    Number(!!(filters.minExposure || filters.maxExposure))
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            variant={filterCount > 0 ? "secondary" : "outline"}
            size={filterCount ? "sm" : "icon"}
            className="shrink-0"
          />
        }
        aria-label={`파일 필터${filterCount ? ` ${filterCount}개 적용` : ""}`}
        title="파일 필터"
      >
        <Funnel data-icon="inline-start" />
        {filterCount > 0 && <CountBadge count={filterCount} />}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="max-h-[80dvh] max-w-[calc(100vw-2rem)] overflow-y-auto"
      >
        <PopoverHeader>
          <PopoverTitle>파일 필터</PopoverTitle>
        </PopoverHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${id}-kind`}>자료 유형</FieldLabel>
            <Choice
              id={`${id}-kind`}
              label="자료 유형"
              value={filters.kind}
              onChange={(kind) => onChange({ ...filters, kind })}
              options={[
                { value: "all", label: "모든 유형" },
                ...["bias", "dark", "flat", "science", "exclude"].map(
                  (value) => ({
                    value,
                    label: value === "exclude" ? "기타" : value,
                  })
                ),
              ]}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-band`}>관측 필터</FieldLabel>
            <Choice
              id={`${id}-band`}
              label="관측 필터"
              value={filters.band}
              onChange={(band) => onChange({ ...filters, band })}
              options={[
                { value: "all", label: "모든 관측 필터" },
                ...bands.map((value) => ({ value, label: value })),
              ]}
            />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field data-invalid={!!rangeError}>
              <FieldLabel htmlFor={`${id}-min-exposure`}>
                최소 노출{" "}
                <span className="ml-auto text-muted-foreground">초</span>
              </FieldLabel>
              <Input
                id={`${id}-min-exposure`}
                inputMode="decimal"
                placeholder="제한 없음"
                value={filters.minExposure}
                aria-invalid={!!rangeError}
                aria-describedby={
                  rangeError ? `${id}-exposure-error` : undefined
                }
                onChange={(event) =>
                  onChange({
                    ...filters,
                    minExposure: event.target.value,
                  })
                }
              />
            </Field>
            <Field data-invalid={!!rangeError}>
              <FieldLabel htmlFor={`${id}-max-exposure`}>
                최대 노출{" "}
                <span className="ml-auto text-muted-foreground">초</span>
              </FieldLabel>
              <Input
                id={`${id}-max-exposure`}
                inputMode="decimal"
                placeholder="제한 없음"
                value={filters.maxExposure}
                aria-invalid={!!rangeError}
                aria-describedby={
                  rangeError ? `${id}-exposure-error` : undefined
                }
                onChange={(event) =>
                  onChange({
                    ...filters,
                    maxExposure: event.target.value,
                  })
                }
              />
            </Field>
          </div>
          {rangeError && (
            <FieldError id={`${id}-exposure-error`}>{rangeError}</FieldError>
          )}
        </FieldGroup>
        <Button
          variant="outline"
          size="sm"
          disabled={!filterCount}
          onClick={() => onChange(defaultFileFilters)}
        >
          필터 초기화
        </Button>
      </PopoverContent>
    </Popover>
  )
}
