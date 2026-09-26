import { expect, test } from "bun:test"
import { createDocumentAutosave } from "../src/lib/document-autosave"

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
test("bursts coalesce recovery serialization and server saving, flush saves the latest value", async () => {
  const recovery: number[] = [],
    saved: number[] = []
  const autosave = createDocumentAutosave<number>({
    delay: 15,
    maxWait: 50,
    writeRecovery: (value) => {
      recovery.push(value)
    },
    clearRecovery: () => {},
    save: async (value) => {
      saved.push(value)
    },
  })
  for (let i = 0; i < 100; i++) autosave.schedule(i)
  expect(recovery).toEqual([])
  expect(saved).toEqual([])
  await autosave.flush()
  expect(recovery).toEqual([99])
  expect(saved).toEqual([99])
  await wait(25)
  expect(saved).toEqual([99])
  autosave.dispose()
})

test("continuous edits have bounded recovery delay and page exit can flush recovery synchronously", async () => {
  const recovery: number[] = []
  const autosave = createDocumentAutosave<number>({
    delay: 40,
    maxWait: 60,
    writeRecovery: (value) => {
      recovery.push(value)
    },
    clearRecovery: () => {},
    save: async () => {},
  })
  for (let i = 0; i < 10; i++) {
    autosave.schedule(i)
    await wait(10)
  }
  expect(recovery.length).toBeGreaterThan(0)
  autosave.schedule(100)
  autosave.flushRecovery()
  expect(recovery.at(-1)).toBe(100)
  await autosave.flush()
  autosave.dispose()
})

test("saves serialize, stale completion never clears newer recovery, flush drains pending edits", async () => {
  let release!: () => void
  const saved: number[] = [],
    cleared: number[] = [],
    recovery: number[] = []
  const autosave = createDocumentAutosave<number>({
    delay: 1000,
    writeRecovery: (value) => {
      recovery.push(value)
    },
    clearRecovery: () => {
      cleared.push(recovery.at(-1)!)
    },
    save: async (value) => {
      saved.push(value)
      if (value === 1)
        await new Promise<void>((resolve) => {
          release = resolve
        })
    },
  })
  autosave.schedule(1)
  const first = autosave.flush()
  await wait(0)
  autosave.schedule(2)
  autosave.flushRecovery()
  const second = autosave.flush()
  expect(saved).toEqual([1])
  release()
  await Promise.all([first, second])
  expect(saved).toEqual([1, 2])
  expect(cleared).toEqual([2])
  autosave.dispose()
})

test("failures retain recovery and allow retry; storage failure does not block server saving", async () => {
  let fail = true,
    cleared = 0,
    saved = 0
  const errors: unknown[] = []
  const autosave = createDocumentAutosave<number>({
    writeRecovery: () => {
      throw new Error("storage full")
    },
    clearRecovery: () => {
      cleared++
    },
    onError: (error) => {
      errors.push(error)
    },
    save: async () => {
      if (fail) throw new Error("offline")
      saved++
    },
  })
  autosave.schedule(1)
  await expect(autosave.flush()).rejects.toThrow("offline")
  expect(cleared).toBe(0)
  fail = false
  await autosave.flush()
  expect(saved).toBe(1)
  expect(cleared).toBe(1)
  expect(errors).toHaveLength(1)
  autosave.dispose()
})

test("reset cancels pending old-document saves and disposal preserves the latest recovery", async () => {
  const saved: string[] = [],
    recovery: string[] = []
  const autosave = createDocumentAutosave<string>({
    delay: 10,
    writeRecovery: (value) => {
      recovery.push(value)
    },
    clearRecovery: () => {},
    save: async (value) => {
      saved.push(value)
    },
  })
  autosave.schedule("old")
  autosave.reset()
  await wait(20)
  expect(saved).toEqual([])
  autosave.schedule("new")
  autosave.dispose()
  expect(recovery).toEqual(["new"])
  await wait(20)
  expect(saved).toEqual([])
})
