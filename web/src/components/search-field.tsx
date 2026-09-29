import { useRef, type ComponentProps, type RefObject } from "react"
import { CircleX, Search } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group"

/** One search field: leading icon, inline clear, Escape clears before closing anything. */
export function SearchField({
  value,
  onValueChange,
  label,
  placeholder = label,
  variant = "filled",
  className,
  inputRef,
  onKeyDown,
  ...props
}: Omit<ComponentProps<"input">, "value" | "onChange" | "ref"> & {
  value: string
  onValueChange: (value: string) => void
  label: string
  variant?: "filled" | "glass"
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const ownRef = useRef<HTMLInputElement>(null)
  const ref = inputRef ?? ownRef
  return (
    <InputGroup
      className={cn("search-field", className)}
      data-variant={variant}
    >
      <InputGroupAddon>
        <Search aria-hidden="true" />
      </InputGroupAddon>
      <InputGroupInput
        ref={ref}
        aria-label={label}
        placeholder={placeholder}
        enterKeyHint="search"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && value) {
            event.preventDefault()
            event.stopPropagation()
            onValueChange("")
          }
          onKeyDown?.(event)
        }}
        {...props}
      />
      <InputGroupAddon
        align="inline-end"
        className="search-field-clear"
        data-hidden={!value}
        inert={!value}
      >
        <InputGroupButton
          size="icon-xs"
          aria-label="검색어 지우기"
          onClick={() => {
            onValueChange("")
            ref.current?.focus()
          }}
        >
          <CircleX />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  )
}
