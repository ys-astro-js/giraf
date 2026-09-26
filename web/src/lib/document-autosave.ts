import debounce from "lodash.debounce"

const SAVE_DELAY_MS = 350
const MAX_SAVE_DELAY_MS = 2000

type Options<T> = {
  save: (value: T) => Promise<void>
  writeRecovery: (value: T) => void
  clearRecovery: () => void
  onSaved?: (value: T) => void
  onError?: (error: unknown) => void
  delay?: number
  maxWait?: number
}

/** One ordered writer for a document; UI changes only replace the pending value. */
export function createDocumentAutosave<T>(options: Options<T>) {
  let revision = 0
  let pending: { value: T; revision: number } | undefined
  let recoveryRevision = -1
  let queuedRevision = -1
  let saving = Promise.resolve()

  function flushRecovery() {
    if (!pending || recoveryRevision === pending.revision) return
    try {
      options.writeRecovery(pending.value)
      recoveryRevision = pending.revision
    } catch {
      // Private browsing and storage quotas must not disable server saving.
    }
  }
  function persist() {
    if (!pending || queuedRevision === pending.revision) return saving
    flushRecovery()
    const current = pending
    queuedRevision = current.revision
    saving = saving
      .catch(() => {})
      .then(async () => {
        if (current.revision !== revision) return
        await options.save(current.value)
        if (current.revision !== revision) return
        pending = undefined
        try {
          options.clearRecovery()
        } catch {
          /* Recovery storage may be unavailable. */
        }
        options.onSaved?.(current.value)
      })
      .catch((error) => {
        if (queuedRevision === current.revision) queuedRevision = -1
        options.onError?.(error)
        throw error
      })
    return saving
  }
  const scheduleSave = debounce(
    () => {
      void persist().catch(() => {})
    },
    options.delay ?? SAVE_DELAY_MS,
    { maxWait: options.maxWait ?? MAX_SAVE_DELAY_MS }
  )
  return {
    schedule(value: T) {
      pending = { value, revision: ++revision }
      scheduleSave()
    },
    async flush() {
      scheduleSave.cancel()
      await persist()
      // Edits can arrive while a request is in flight.
      while (pending) {
        scheduleSave.cancel()
        await persist()
      }
    },
    flushRecovery,
    reset() {
      scheduleSave.cancel()
      revision++
      pending = undefined
      recoveryRevision = -1
      queuedRevision = -1
    },
    dispose() {
      flushRecovery()
      scheduleSave.cancel()
    },
  }
}
