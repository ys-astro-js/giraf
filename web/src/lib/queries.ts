import { QueryClient, queryOptions, type Query } from "@tanstack/react-query"
import { api, type Job } from "./workbench"

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The local IRAF server remains reachable without an internet connection.
        networkMode: "always",
        retry: false,
        refetchOnWindowFocus: false,
      },
      mutations: { networkMode: "always", retry: false },
    },
  })
}

export function apiQueryOptions<T>(action: string, scope = "global") {
  return queryOptions({
    queryKey: ["api", scope, action],
    queryFn: ({ signal }) => api<T>(action, undefined, signal),
  })
}

export const activeJob = (job: Job) => ["queued", "running", "waiting"].includes(job.state)

export function jobQueryOptions(id: string) {
  return {
    ...apiQueryOptions<Job>(`job?id=${encodeURIComponent(id)}&details=1`),
    // A terminal summary can arrive before the final log; always fetch fresh details.
    staleTime: 0,
    refetchInterval: (query: Query<Job, Error, Job, string[]>) => query.state.data && !activeJob(query.state.data) ? false : 1200,
    refetchIntervalInBackground: true,
  }
}
