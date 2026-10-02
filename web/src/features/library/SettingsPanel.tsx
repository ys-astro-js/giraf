import { Moon, Sun } from "lucide-react"
import {
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { Choice } from "@/components/workbench-controls"
import { useTheme } from "@/components/theme-provider"
import { useWorkbench } from "@/features/workbench/context"

/** App preferences: theme, execution engine and window layout. */
export function SettingsPanel() {
  const { theme, setTheme } = useTheme()
  const w = useWorkbench()
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
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </div>
  )
}
