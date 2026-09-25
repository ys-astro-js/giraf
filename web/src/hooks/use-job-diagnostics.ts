import { useEffect, useRef } from "react"
import { api, type Job } from "@/lib/workbench"
import { diagnostics, jobDiagnosticContext } from "@/lib/diagnostics"

export function jobsNeedingDiagnostics(
  jobs: Job[],
  store: Pick<typeof diagnostics, "isResolved"> = diagnostics
) {
  return jobs
    .filter(
      (job) =>
        ["completed", "failed"].includes(job.state) &&
        job.log === undefined &&
        !store.isResolved(jobDiagnosticContext(job))
    )
    .map((job) => job.id)
}

// Workflow summaries omit logs. Read each finished run once without opening its tray.
export function useJobDiagnostics(jobs: Job[]) {
  const pending = useRef<string[]>([])
  const observed = useRef(new Set<string>())
  const workers = useRef(0)
  useEffect(() => {
    for (const id of jobsNeedingDiagnostics(jobs)) {
      if (observed.current.has(id)) continue
      observed.current.add(id)
      pending.current.push(id)
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
