import { useEffect, useRef } from "react"
import { api, type Job } from "@/lib/workbench"

// Workflow summaries omit logs. Read each finished run once without opening its tray.
export function useJobDiagnostics(jobs: Job[]) {
  const pending = useRef<string[]>([])
  const observed = useRef(new Set<string>())
  const workers = useRef(0)
  useEffect(() => {
    for (const job of jobs) {
      if (
        !["completed", "failed"].includes(job.state) ||
        job.log !== undefined ||
        observed.current.has(job.id)
      )
        continue
      observed.current.add(job.id)
      pending.current.push(job.id)
    }
    async function drain() {
      workers.current++
      try {
        while (pending.current.length) {
          const id = pending.current.shift()!
          // api records request failures as well as the returned log diagnostics.
          try {
            await api<Job>(`job?id=${encodeURIComponent(id)}&details=1`)
          } catch {
            /* Already reported. */
          }
        }
      } finally {
        workers.current--
      }
    }
    while (pending.current.length && workers.current < 3) void drain()
  }, [jobs])
}
