import { afterEach, expect, test } from "bun:test"
import { QueryObserver } from "@tanstack/react-query"
import { createQueryClient } from "../src/lib/queries"
import { imageInfoQueryOptions, pixelQueryOptions } from "../src/lib/image-queries"
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
  diagnostics.clear()
})

test("viewer and comparison share image information and keep a shared request alive", async () => {
  let finish!: (response: Response) => void
  let signal!: AbortSignal
  const urls: string[] = []
  globalThis.fetch = ((url, init) => {
    urls.push(String(url))
    signal = init?.signal as AbortSignal
    return new Promise<Response>(resolve => { finish = resolve })
  }) as typeof fetch
  const cache = client()
  const options = imageInfoQueryOptions("a & b")
  const viewer = new QueryObserver(cache, options)
  const comparison = new QueryObserver(cache, options)
  const leaveViewer = viewer.subscribe(() => {})
  const leaveComparison = comparison.subscribe(() => {})
  const pending = cache.fetchQuery(options)
  expect(urls).toEqual(["/api/info?id=a%20%26%20b"])
  leaveViewer()
  expect(signal.aborted).toBe(false)
  finish(Response.json({ low: 1, high: 10 }))
  await pending
  expect(comparison.getCurrentResult().data).toEqual({ low: 1, high: 10 })
  const refreshing = comparison.refetch()
  expect(urls).toHaveLength(2)
  leaveComparison()
  expect(signal.aborted).toBe(true)
  finish(Response.json({ low: 2, high: 20 }))
  await refreshing
  expect(cache.getQueryData(options.queryKey)).toEqual({ low: 1, high: 10 })
})

test("switching pixel coordinates cancels obsolete requests and never displays their late response", async () => {
  const requests: { signal: AbortSignal; finish: (response: Response) => void }[] = []
  globalThis.fetch = ((_url, init) => new Promise<Response>(finish => {
    requests.push({ signal: init?.signal as AbortSignal, finish })
  })) as typeof fetch
  const cache = client()
  const old = pixelQueryOptions("a", 1, 2)
  const current = pixelQueryOptions("a", 2, 2)
  const observer = new QueryObserver(cache, old)
  const leave = observer.subscribe(() => {})
  observer.setOptions(current)
  expect(requests[0].signal.aborted).toBe(true)
  expect(observer.getCurrentResult().data).toBeUndefined()
  const pending = cache.fetchQuery(current)
  requests[1].finish(Response.json({ x: 2, y: 2, value: 20 }))
  await pending
  requests[0].finish(Response.json({ x: 1, y: 2, value: 10 }))
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(observer.getCurrentResult().data?.value).toBe(20)
  expect(diagnostics.getSnapshot()).toHaveLength(0)
  leave()
})

test("image failures support explicit retry and reopening a file refreshes metadata", async () => {
  let requests = 0
  globalThis.fetch = (() => {
    requests++
    return Promise.resolve(requests === 1
      ? Response.json({ error: "정보 조회 실패" }, { status: 500 })
      : Response.json({ low: requests, high: 10 }))
  }) as typeof fetch
  const cache = client()
  const options = imageInfoQueryOptions("a")
  await expect(cache.fetchQuery(options)).rejects.toThrow("정보 조회 실패")
  expect(requests).toBe(1)
  expect((await cache.fetchQuery(options)).low).toBe(2)
  expect((await cache.fetchQuery(options)).low).toBe(3)
})

test("empty viewers and unselected pixels do not request data", () => {
  let requests = 0
  globalThis.fetch = (() => { requests++; return Promise.resolve(Response.json({})) }) as typeof fetch
  const cache = client()
  const image = new QueryObserver(cache, imageInfoQueryOptions(undefined))
  const pixel = new QueryObserver(cache, pixelQueryOptions(undefined, 0, 0))
  const leaveImage = image.subscribe(() => {})
  const leavePixel = pixel.subscribe(() => {})
  expect(requests).toBe(0)
  leaveImage()
  leavePixel()
})
