import { afterEach, expect, test } from "bun:test"
import { onlineManager } from "@tanstack/react-query"
import { createQueryClient, apiQueryOptions, jobQueryOptions } from "../src/lib/queries"
import { diagnostics } from "../src/lib/diagnostics"

const originalFetch = globalThis.fetch
const clients: ReturnType<typeof createQueryClient>[] = []
function client() {
  const value = createQueryClient()
  clients.push(value)
  return value
}
afterEach(() => {
  clients.splice(0).forEach(value => value.clear())
  globalThis.fetch = originalFetch
  onlineManager.setOnline(true)
  diagnostics.clear()
})

test("simultaneous observers of a job share one request and terminal jobs stop polling", async () => {
  let finish!: (response: Response) => void
  let requests = 0
  globalThis.fetch = (() => { requests++; return new Promise<Response>(resolve => { finish = resolve }) }) as typeof fetch
  const cache = client()
  const options = jobQueryOptions("job with spaces")
  const first = cache.fetchQuery(options)
  const second = cache.fetchQuery(options)
  expect(requests).toBe(1)
  finish(Response.json({ id: "job with spaces", state: "completed", products: [] }))
  expect(await first).toEqual(await second)
  const query = cache.getQueryCache().find({ queryKey: options.queryKey })!
  expect(options.refetchInterval(query)).toBe(false)
  cache.setQueryData(options.queryKey, { id: "job with spaces", state: "waiting", products: [] })
  expect(options.refetchInterval(query)).toBe(1200)
})

test("cancelling a query aborts fetch without adding user-facing errors or stale cache data", async () => {
  let signal: AbortSignal | undefined
  globalThis.fetch = ((_url, init) => new Promise<Response>((_resolve, reject) => {
    signal = init?.signal as AbortSignal
    signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
  })) as typeof fetch
  const cache = client()
  const options = jobQueryOptions("old")
  const pending = cache.fetchQuery(options).catch(() => undefined)
  await cache.cancelQueries({ queryKey: options.queryKey })
  await pending
  expect(signal?.aborted).toBe(true)
  expect(cache.getQueryData(options.queryKey)).toBeUndefined()
  expect(diagnostics.getSnapshot()).toHaveLength(0)
})

test("local queries work offline, keep workspace scopes separate, and expose failures without retry", async () => {
  onlineManager.setOnline(false)
  let requests = 0
  globalThis.fetch = (() => { requests++; return Promise.resolve(Response.json({ folder: String(requests) })) }) as typeof fetch
  const cache = client()
  const first = apiQueryOptions<{ folder: string }>("workspace", "a")
  const second = apiQueryOptions<{ folder: string }>("workspace", "b")
  expect(await cache.fetchQuery(first)).toEqual({ folder: "1" })
  expect(await cache.fetchQuery(second)).toEqual({ folder: "2" })
  expect(cache.getQueryData(first.queryKey)).toEqual({ folder: "1" })
  globalThis.fetch = (() => { requests++; return Promise.resolve(Response.json({ error: "실패" }, { status: 400 })) }) as typeof fetch
  await expect(cache.fetchQuery(jobQueryOptions("bad"))).rejects.toThrow("실패")
  expect(requests).toBe(3)
})
