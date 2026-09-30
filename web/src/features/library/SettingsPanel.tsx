import { useState } from "react"
import { Moon, Sun } from "lucide-react"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { Choice } from "@/components/workbench-controls"
import { useTheme } from "@/components/theme-provider"
import { useWorkbench } from "@/features/workbench/context"
import { applyPreset } from "@/features/dock/store"
import { PRESETS, type PresetId } from "@/features/dock/presets"

/** App preferences: theme, execution engine and window layout. */
export function SettingsPanel() {
  const { theme, setTheme } = useTheme()
  const w = useWorkbench()
  const [preset, setPreset] = useState<PresetId>("default")
  return (
    <div className="library-window">
      <SidebarContent className="scroll-fade scroll-fade-4">
        <SidebarGroup>
          <SidebarGroupContent className="flex flex-col gap-4">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                  aria-label="테마 전환"
                >
                  {theme === "dark" ? <Sun /> : <Moon />}
                  <span>{theme === "dark" ? "밝은 테마" : "어두운 테마"}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
            <div className="px-2">
              <Choice
                label="실행 엔진"
                value={w.task?.backend || w.prefs.backend}
                options={[
                  { value: "cl", label: "IRAF CL" },
                  { value: "pyraf", label: "PyRAF" },
                ]}
                onChange={w.setBackend}
              />
            </div>
            <div className="flex flex-col gap-2 px-2">
              <Choice
                label="창 배치"
                value={preset}
                options={PRESETS.map(({ id, label }) => ({
                  value: id,
                  label,
                }))}
                onChange={(value) => setPreset(value as PresetId)}
              />
              <Button variant="outline" onClick={() => applyPreset(preset)}>
                이 배치로 초기화
              </Button>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </div>
  )
}
