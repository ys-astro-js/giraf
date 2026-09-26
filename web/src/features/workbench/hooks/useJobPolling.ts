import { useQueries, type UseQueryResult } from "@tanstack/react-query"
import { jobQueryOptions, activeJob } from "@/lib/queries"
import { useEffect, useMemo, useRef } from "react"
import { toast } from "@/components/ui/toast"
import { type Catalog, type Frame, type Job } from "@/lib/workbench"
import type * as React from "react"

const active = activeJob
function combineJobs(results: UseQueryResult<Job>[]) {
  return {
    jobs: results.flatMap((result) => (result.data ? [result.data] : [])),
    error: results.find((result) => result.error)?.error,
  }
}
export function useJobPolling({
  jobs,
  selectedJob,
  ready,
  setJobs,
  remember,
  publishJob,
  refresh,
  setError,
}: {
  jobs: Job[]
  selectedJob: string
  ready: boolean
  setJobs: React.Dispatch<React.SetStateAction<Job[]>>
  remember: (rows: Frame[]) => void
  publishJob: (instanceId: string, job: Job, catalog?: Catalog) => void
  refresh: () => Promise<void>
  setError: React.Dispatch<React.SetStateAction<string>>
}) {
  const observedJobs = useMemo(
    () => [
      ...new Set([
        ...jobs.filter(active).map((job) => job.id),
        ...(selectedJob ? [selectedJob] : []),
      ]),
    ],
    [jobs, selectedJob]
  )
  const jobResults = useQueries({
    queries: observedJobs.map((id) => ({
      ...jobQueryOptions(id),
      enabled: ready,
    })),
    combine: combineJobs,
  })
  const appliedJobs = useRef(new Map<string, Job>())
  useEffect(() => {
    const incoming = jobResults.jobs.filter(
      (job) => appliedJobs.current.get(job.id) !== job
    )
    if (!incoming.length) return
    // Opening historical logs must not publish that run over the current graph.
    const tracked = incoming.filter((job) => {
      const previous =
        appliedJobs.current.get(job.id) ||
        jobs.find((current) => current.id === job.id)
      return active(job) || (previous && active(previous))
    })
    const completed = tracked.some((job) => !active(job))
    incoming.forEach((job) => appliedJobs.current.set(job.id, job))
    setJobs((old) =>
      old.map((job) => incoming.find((next) => next.id === job.id) || job)
    )
    remember(incoming.flatMap((job) => job.products || []))
    for (const job of tracked)
      if (job.manifest?.instanceId) publishJob(job.manifest.instanceId, job)
    if (completed) void refresh().catch((error) => setError(error.message))
  }, [jobResults.jobs, jobs, refresh, remember, publishJob, setJobs, setError])
  useEffect(() => {
    if (jobResults.error)
      toast.add({ title: jobResults.error.message, type: "error" })
  }, [jobResults.error])
}
