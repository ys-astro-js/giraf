import { useId } from "react"
import { Settings2 } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Choice } from "@/components/workbench-controls"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { useTheme } from "@/components/theme-provider"
import { useWorkbench } from "@/features/workbench/context"

const THEMES = [
  { value: "system", label: "시스템 설정" },
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
]

/** App preferences, in one place: the theme and the execution engine. */
export function SettingsButton() {
  const id = useId()
  const { theme, setTheme } = useTheme()
  const w = useWorkbench()
  return (
    <ToolbarGroup label="설정">
      <Popover>
        <PopoverTrigger render={<ToolbarButton label="설정" />}>
          <Settings2 />
        </PopoverTrigger>
        <PopoverContent align="end" sideOffset={8}>
          <PopoverHeader>
            <PopoverTitle>설정</PopoverTitle>
          </PopoverHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-theme`}>테마</FieldLabel>
              <Choice
                id={`${id}-theme`}
                label="테마"
                value={theme}
                options={THEMES}
                onChange={(value) => setTheme(value as typeof theme)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-backend`}>실행 엔진</FieldLabel>
              <Choice
                id={`${id}-backend`}
                label="실행 엔진"
                value={w.task?.backend || w.prefs.backend}
                options={[
                  { value: "cl", label: "IRAF CL" },
                  { value: "pyraf", label: "PyRAF" },
                ]}
                onChange={w.setBackend}
              />
            </Field>
          </FieldGroup>
        </PopoverContent>
      </Popover>
    </ToolbarGroup>
  )
}
