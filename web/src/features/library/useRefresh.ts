import { useState } from "react"

/** Runs a list's refresh, reporting failures, and says while it works. */
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
