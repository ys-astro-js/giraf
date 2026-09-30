import { Moon, Sun } from "lucide-react"
import {
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
} from "@/components/ui/sidebar"
import { Choice } from "@/components/workbench-controls"
import { useTheme } from "@/components/theme-provider"
import { LibrarySidebar } from "@/features/library/Library"
import { useWorkbench } from "@/features/workbench/context"

export function LibraryPanel() {
  const { theme, setTheme } = useTheme()
  const w = useWorkbench()
  return (
    <LibrarySidebar
      key={w.workspace.folder}
      workspace={w.workspace}
      catalog={w.catalog}
      onRefreshCatalog={w.refreshCatalog}
      jobs={w.jobs}
      currentExecution={w.workflow}
      onViewLog={w.viewLog}
      ready={w.ready}
      loadError={w.loadError}
      selected={w.selectedFiles}
      onSelect={w.setSelectedFiles}
      onOpen={w.assetViewer.open}
      onRefresh={w.refresh}
      onError={w.setError}
      onAddTask={(name) => w.add(name, [])}
      onUse={() => w.setAddOpen(true)}
      onDeleteFiles={(ids) => w.deleteLibrary("files", ids)}
      onDeleteJobs={(ids) => w.deleteLibrary("jobs", ids)}
    >
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
      <div className="px-2 pb-2">
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
    </LibrarySidebar>
  )
}
