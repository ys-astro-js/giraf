import { useState } from "react"
import type { Frame } from "@/lib/workbench"
import { SidebarMenu } from "@/components/ui/sidebar"
import { Button } from "@/components/ui/button"
import { CountBadge } from "@/components/count-badge"
import { FileRow, type SelectFiles } from "./shared"

/** Paged file rows; each list key remembers how far it was expanded. */
export function useFileList({
  selected,
  selecting,
  onSelect,
  onOpen,
}: {
  selected: Set<string>
  selecting: boolean
  onSelect: SelectFiles
  onOpen: (file: Frame) => void
}) {
  const [limits, setLimits] = useState<Record<string, number>>({})
  const limit = (key: string) => limits[key] || 80
  function fileList(files: Frame[], key: string) {
    return (
      <>
        <SidebarMenu>
          {files.slice(0, limit(key)).map((file) => (
            <FileRow
              key={file.id}
              file={file}
              selected={selected.has(file.id)}
              selecting={selecting}
              onSelect={onSelect}
              onOpen={onOpen}
            />
          ))}
        </SidebarMenu>
        {files.length > limit(key) && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full"
            onClick={() =>
              setLimits((values) => ({ ...values, [key]: limit(key) + 80 }))
            }
          >
            더 보기 <CountBadge count={files.length - limit(key)} />
          </Button>
        )}
      </>
    )
  }
  return { fileList, resetLimits: () => setLimits({}) }
}

export function useRefresh(
  refresh: (() => Promise<unknown>) | undefined,
  onError: (message: string) => void
) {
  const [refreshing, setRefreshing] = useState(false)
  async function run() {
    if (!refresh) return
    setRefreshing(true)
    try {
      await refresh()
    } catch (error) {
      onError(
        error instanceof Error
          ? error.message
          : "목록을 새로고침하지 못했습니다."
      )
    } finally {
      setRefreshing(false)
    }
  }
  return { refreshing, refresh: run }
}
