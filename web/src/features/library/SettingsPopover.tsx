import { useId } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { LoaderCircle, Settings2 } from "lucide-react"
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Separator } from "@/components/ui/separator"
import { Choice } from "@/components/workbench-controls"
import { ToolbarButton, ToolbarGroup } from "@/components/toolbar"
import { useTheme } from "@/components/theme-provider"
import { useWorkbench } from "@/features/workbench/context"
import { checkForUpdate, useAppUpdate, type UpdateState } from "@/lib/app-update"
import { apiQueryOptions } from "@/lib/queries"
import { api, type Home } from "@/lib/workbench"

const THEMES = [
  { value: "system", label: "시스템 설정" },
  { value: "light", label: "밝게" },
  { value: "dark", label: "어둡게" },
]

const STARTUP = [
  { value: "home", label: "메인 화면 표시" },
  { value: "resume", label: "마지막 작업 이어서" },
]

/**
 * App preferences, in one place: the theme, the execution engine and the
 * startup screen; in the desktop app also its version and update check.
 */
export function SettingsButton() {
  const id = useId()
  const { theme, setTheme } = useTheme()
  const w = useWorkbench()
  const queryClient = useQueryClient()
  const home = apiQueryOptions<Home>("home")
  const startup = useQuery(home).data?.startup
  async function setStartup(value: string) {
    try {
      queryClient.setQueryData(home.queryKey, await api<Home>("home", { startup: value }))
    } catch (e) {
      w.setError((e as Error).message)
    }
  }
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
            <Field>
              <FieldLabel htmlFor={`${id}-startup`}>앱을 열 때</FieldLabel>
              <Choice
                id={`${id}-startup`}
                label="앱을 열 때"
                value={startup || "home"}
                options={STARTUP}
                onChange={(value) => void setStartup(value)}
              />
            </Field>
          </FieldGroup>
          <AppVersion />
        </PopoverContent>
      </Popover>
    </ToolbarGroup>
  )
}

/** The desktop app's version; restarting into an update is the toolbar's. */
function AppVersion() {
  const update = useAppUpdate()
  if (!update) return null
  return (
    <>
      <Separator />
      <div className="flex min-h-8 items-center justify-between gap-3">
        <span>GIRAF {update.current}</span>
        <UpdateStatus update={update} />
      </div>
    </>
  )
}

function UpdateStatus({ update }: { update: UpdateState }) {
  switch (update.state) {
    case "idle":
      return (
        <Button variant="outline" size="sm" onClick={checkForUpdate}>
          업데이트 확인
        </Button>
      )
    case "checking":
      return (
        <LoaderCircle
          role="status"
          aria-label="업데이트 확인 중"
          className="size-4 text-muted-foreground motion-safe:animate-spin"
        />
      )
    case "not-available":
      return <span className="text-muted-foreground">최신 버전</span>
    case "error":
      return <span className="truncate text-muted-foreground">확인하지 못했습니다</span>
    case "downloading":
      return <span className="text-muted-foreground">{update.version} 받는 중</span>
    case "downloaded":
      return <span className="text-muted-foreground">{update.version} 준비됨</span>
  }
}
