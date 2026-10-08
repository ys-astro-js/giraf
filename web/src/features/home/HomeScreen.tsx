import { useQuery } from "@tanstack/react-query"
import { CircleCheck, CircleX, Folder, FolderOpen, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ToolbarCluster } from "@/components/toolbar"
import { SettingsButton } from "@/features/library/SettingsPopover"
import { useWorkbench } from "@/features/workbench/context"
import { apiQueryOptions } from "@/lib/queries"
import type { Home } from "@/lib/workbench"
import lightIcon from "@/assets/icons/giraf-light.png"
import darkIcon from "@/assets/icons/giraf-dark.png"

const time = new Intl.DateTimeFormat("ko", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
const day = new Intl.DateTimeFormat("ko", { month: "long", day: "numeric" })
const fullDay = new Intl.DateTimeFormat("ko", { year: "numeric", month: "long", day: "numeric" })

function opened(seconds: number, withTime = false) {
  const date = new Date(seconds * 1000), now = new Date()
  if (date.toDateString() === now.toDateString()) return withTime ? `오늘 ${time.format(date)}` : "오늘"
  return (date.getFullYear() === now.getFullYear() ? day : fullDay).format(date)
}

/** The screen the app opens on: the last work, recent folders and whether IRAF can run. */
export function HomeScreen() {
  const w = useWorkbench()
  const home = useQuery({ ...apiQueryOptions<Home>("home"), refetchOnMount: "always" })
  const recent = home.data?.recent ?? []
  const current = recent.find((row) => row.path === w.workspace.folder)
  const engines = home.data?.engines
  return (
    <div className="home-screen">
      <header className="workbench-toolbar" aria-label="도구 막대">
        <div className="toolbar-start" />
        <div className="toolbar-center" />
        <div className="toolbar-end">
          <ToolbarCluster className="toolbar-trailing" edge="end">
            <SettingsButton />
          </ToolbarCluster>
        </div>
      </header>
      <main className="home-content">
        <div className="home-column">
          <div className="flex items-center gap-4">
            <img src={lightIcon} alt="" className="size-18 dark:hidden" />
            <img src={darkIcon} alt="" className="hidden size-18 dark:block" />
            <h1 className="text-3xl font-semibold tracking-tight">GIRAF</h1>
          </div>

          {current && (
            <section aria-label="마지막 작업" className="flex items-center gap-5 rounded-3xl bg-muted py-5 pr-5 pl-6">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <h2 className="truncate text-xl font-semibold tracking-tight">{current.workflow || "새 워크플로우"}</h2>
                <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
                  <FolderOpen className="size-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{current.name}</span>
                </p>
              </div>
              <span className="shrink-0 text-sm text-muted-foreground">{opened(current.opened, true)}</span>
              <Button onClick={() => w.setHome(false)} disabled={w.documentBusy}>이어서 작업</Button>
            </section>
          )}

          <section aria-labelledby="home-recent" className="flex flex-col gap-2">
            <div className="flex min-h-9 items-center justify-between">
              <h2 id="home-recent" className="text-sm font-semibold text-muted-foreground">최근 폴더</h2>
              {recent.length > 0 && (
                <Button variant="ghost" size="sm" onClick={w.folder} disabled={w.documentBusy}>
                  <FolderOpen data-icon="inline-start" />폴더 열기
                </Button>
              )}
            </div>
            {home.isPending ? (
              <div className="flex flex-col gap-2" aria-label="최근 폴더 불러오는 중">
                <Skeleton className="h-13 w-full" />
                <Skeleton className="h-13 w-3/4" />
              </div>
            ) : recent.length ? (
              <ul className="-mx-3 flex flex-col">
                {recent.map((row) => (
                  <li key={row.path}>
                    <Button
                      variant="ghost"
                      className="h-auto min-h-13 w-full justify-start gap-3 rounded-2xl px-3 py-2 text-start font-normal"
                      disabled={w.documentBusy}
                      title={row.path}
                      onClick={() => void w.openFolder(row.path)}
                    >
                      <Folder className="size-4.5" aria-hidden="true" />
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="truncate font-medium">{row.name}</span>
                        <span className="truncate text-muted-foreground">{row.parent}</span>
                      </span>
                      <span className="shrink-0 text-muted-foreground">{opened(row.opened)}</span>
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="flex min-h-60 flex-col items-center justify-center gap-4 rounded-3xl bg-muted">
                <p className="text-sm text-muted-foreground">최근 폴더가 없습니다</p>
                <Button onClick={w.folder} disabled={w.documentBusy}>
                  <FolderOpen data-icon="inline-start" />폴더 열기
                </Button>
              </div>
            )}
          </section>

          <section aria-labelledby="home-engines" className="flex items-center gap-6 border-t pt-5 text-sm">
            <h2 id="home-engines" className="font-semibold text-muted-foreground">실행 환경</h2>
            {engines ? (
              <>
                <Engine name="IRAF CL" available={engines.cl} />
                <Engine name="PyRAF" available={engines.pyraf} />
              </>
            ) : (
              <Skeleton className="h-5 w-40" />
            )}
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto"
              aria-label="실행 환경 다시 확인"
              title="실행 환경 다시 확인"
              disabled={home.isFetching}
              onClick={() => void home.refetch()}
            >
              <RefreshCw />
            </Button>
          </section>
        </div>
      </main>
    </div>
  )
}

function Engine({ name, available }: { name: string; available: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      {available ? (
        <CircleCheck className="size-4 text-primary" aria-hidden="true" />
      ) : (
        <CircleX className="size-4 text-destructive" aria-hidden="true" />
      )}
      {name}
      {!available && <span className="text-destructive">찾을 수 없음</span>}
    </span>
  )
}
